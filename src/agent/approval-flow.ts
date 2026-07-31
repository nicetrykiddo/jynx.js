import type { AppConfig } from '../config.js';
import type { AuthService } from '../core/auth.js';
import type { Logger } from '../core/logger.js';
import type { Reporter } from '../core/reporter.js';
import type { Repository } from '../storage/repository.js';
import type { Approval } from '../storage/schema.js';
import type { AgentPlan, AgentRunner } from './runner.js';
import { telegramMessageLink } from '../core/reporter.js';
import {
  normalizeCapabilities,
  requiresTrustedChannel,
  type Capability,
} from '../core/capabilities.js';
import { normalizeReply } from '../core/conversation.js';

export interface ApprovalFlowDeps {
  config: Pick<AppConfig, 'GITHUB_REPO'>;
  auth: AuthService;
  repository: Repository;
  reporter: Reporter;
  runner: AgentRunner;
  logger: Logger;
}

export interface DecisionResult {
  reply: string;
}

interface IdeaPayload {
  summary?: string;
  idea?: string;
  publicRequest?: string;
  capabilities?: Capability[];
  trustedChannel?: boolean;
  requesterRole?: string;
}

interface PlanPayload extends IdeaPayload {
  plan?: AgentPlan;
}

function asPlanPayload(payload: unknown): PlanPayload {
  if (payload && typeof payload === 'object') {
    return payload as PlanPayload;
  }
  return {};
}

function approvalContext(approval: Approval): string[] {
  const sourceLink =
    approval.sourceChatId && approval.sourceMessageId
      ? telegramMessageLink(approval.sourceChatId, approval.sourceMessageId)
      : null;
  return [
    `Requested by: ${approval.requestedByName ?? 'unknown'} (${approval.requestedBy ?? 'unknown'})`,
    ...(sourceLink ? [`Source message: ${sourceLink}`] : []),
  ];
}

export class ApprovalFlow {
  public constructor(private readonly deps: ApprovalFlowDeps) {}

  public async approve(userId: number, approvalId: number): Promise<DecisionResult> {
    if (!this.deps.auth.canApprove(userId)) {
      return { reply: 'only the owner can approve.' };
    }

    const approval = await this.deps.repository.getApproval(approvalId);
    if (!approval) {
      return { reply: `approval #${approvalId} not found.` };
    }
    if (approval.status !== 'pending') {
      return { reply: `approval #${approvalId} is already ${approval.status}.` };
    }
    const payload = asPlanPayload(approval.payload);
    const capabilities = normalizeCapabilities(payload.capabilities);
    if (
      (approval.kind === 'feature' && !capabilities.includes('repo.write')) ||
      (approval.kind !== 'feature' && capabilities.includes('repo.write'))
    ) {
      return { reply: `approval #${approvalId} failed its capability check.` };
    }
    if (
      requiresTrustedChannel(capabilities) &&
      (!payload.trustedChannel ||
        approval.requestedBy === null ||
        !this.deps.auth.isOwner(approval.requestedBy))
    ) {
      return { reply: `approval #${approvalId} failed its trusted-access check.` };
    }

    if (approval.stage === 'idea') {
      return approval.kind === 'feature'
        ? this.approveIdea(approvalId)
        : this.approveAction(userId, approval);
    }
    if (approval.stage === 'plan') {
      return this.approvePlan(userId, approvalId);
    }
    return { reply: `approval #${approvalId} is in an unknown stage.` };
  }

  private async approveAction(userId: number, approval: Approval): Promise<DecisionResult> {
    const payload = asPlanPayload(approval.payload);
    const idea = payload.summary ?? approval.summary;
    const capabilities = normalizeCapabilities(payload.capabilities);
    const decided = await this.deps.repository.decideApproval(approval.id, 'approved', userId);
    if (!decided) return { reply: `approval #${approval.id} was already decided.` };
    await this.editApproval(
      decided,
      `✅ Approval #${approval.id} approved\nRunning this as a read-only action. No branch or PR will be created.\n${approvalContext(decided).join('\n')}`,
    );
    void this.runActionInBackground(idea, capabilities, decided);
    return {
      reply: `approval #${approval.id} approved. i'll update this message with the result.`,
    };
  }

  private async runActionInBackground(
    idea: string,
    capabilities: Capability[],
    approval: Approval,
  ): Promise<void> {
    try {
      const result = await this.deps.runner.executeAction(
        idea,
        capabilities,
        approval.requestedBy ?? null,
      );
      const output = normalizeReply(result.output ?? 'No result returned.');
      const text =
        result.status === 'done'
          ? `✅ Approval #${approval.id} completed\n${output.slice(0, 2800)}\n${approvalContext(approval).join('\n')}`
          : `⚠️ Approval #${approval.id} failed\n${(result.error ?? 'unknown').slice(0, 500)}\n${approvalContext(approval).join('\n')}`;
      await this.editApproval(approval, text);
      await this.notifySource(
        approval,
        result.status === 'done'
          ? '✅ Request completed.'
          : "⚠️ Your request couldn't be completed. The approval message has the status.",
        result.status === 'done' ? output : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ err: message, approvalId: approval.id }, 'action run crashed');
      await this.editApproval(
        approval,
        `⚠️ Approval #${approval.id} crashed\n${message.slice(0, 500)}\n${approvalContext(approval).join('\n')}`,
      );
      await this.notifySource(approval, "⚠️ Your request couldn't be completed.");
    }
  }

  private async approveIdea(approvalId: number): Promise<DecisionResult> {
    const approval = await this.deps.repository.getApproval(approvalId);
    if (!approval) {
      return { reply: `approval #${approvalId} not found.` };
    }

    const payload = asPlanPayload(approval.payload);
    const idea = payload.idea ?? payload.summary ?? approval.summary;

    let plan: AgentPlan;
    try {
      plan = await this.deps.runner.plan(idea);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ err: message, approvalId }, 'planning failed');
      return { reply: `couldn't draft a plan for #${approvalId}: ${message.slice(0, 200)}` };
    }

    const updated = await this.deps.repository.updateApprovalStagePlan(
      approvalId,
      plan.summary.slice(0, 120),
      { ...payload, idea, plan },
    );
    if (!updated) {
      return { reply: `approval #${approvalId} changed while the plan was being drafted.` };
    }

    const text = [
      `Approval #${approvalId} — plan ready`,
      `branch: ${plan.branch}`,
      '',
      'steps:',
      ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      'tests:',
      ...plan.testPlan.map((s) => `- ${s}`),
      '',
      ...approvalContext(updated),
      '',
      'Tap a button below to build it or drop it.',
    ].join('\n');

    await this.editApproval(updated, text, approvalId);
    return {
      reply: `approval #${approvalId} is now a plan. review it, then approve again to build.`,
    };
  }

  private async approvePlan(userId: number, approvalId: number): Promise<DecisionResult> {
    const approval = await this.deps.repository.getApproval(approvalId);
    if (!approval) {
      return { reply: `approval #${approvalId} not found.` };
    }

    const payload = asPlanPayload(approval.payload);
    const plan = payload.plan;
    const idea = payload.idea ?? payload.summary ?? approval.summary;
    const publicRequest = payload.publicRequest ?? payload.summary ?? approval.summary;

    if (!plan) {
      return { reply: `approval #${approvalId} has no plan payload.` };
    }

    const decided = await this.deps.repository.decideApproval(approvalId, 'approved', userId);
    if (!decided) {
      return { reply: `approval #${approvalId} was already decided.` };
    }

    await this.editApproval(
      decided,
      `✅ Approval #${approvalId} approved\n\nBuilding on branch ${plan.branch}.\n\n${approvalContext(decided).join('\n')}`,
    );
    void this.runInBackground(idea, publicRequest, plan, decided);

    return {
      reply: `plan #${approvalId} approved. building on branch ${plan.branch}, i'll post the PR when it's up.`,
    };
  }

  private async runInBackground(
    idea: string,
    publicRequest: string,
    plan: AgentPlan,
    approval: Approval,
  ): Promise<void> {
    const approvalId = approval.id;
    try {
      const result = await this.deps.runner.execute(
        idea,
        publicRequest,
        plan,
        approval.requestedBy ?? null,
      );
      if (result.status === 'done') {
        const completion = result.deploymentRequested
          ? `✅ Approval #${approvalId} built and queued for verified merge/deployment`
          : `✅ Approval #${approvalId} built`;
        await this.editApproval(
          approval,
          `${completion}\nPR: ${result.prUrl ?? '(no url)'}\n\n${approvalContext(approval).join('\n')}`,
        );
        await this.notifySource(
          approval,
          result.deploymentRequested
            ? '✅ Your change is queued for isolated checks, merge, verification of main, and deployment.'
            : '✅ Your request is complete and the automated checks passed. The approval message has the result.',
        );
      } else {
        await this.editApproval(
          approval,
          `⚠️ Approval #${approvalId} failed\n${(result.error ?? 'unknown').slice(0, 300)}\n\n${approvalContext(approval).join('\n')}`,
        );
        await this.notifySource(approval, "⚠️ Your request couldn't be completed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ err: message, approvalId }, 'background run failed');
      await this.editApproval(
        approval,
        `⚠️ Approval #${approvalId} crashed\n${message.slice(0, 300)}\n\n${approvalContext(approval).join('\n')}`,
      );
      await this.notifySource(approval, "⚠️ Your request couldn't be completed.");
    }
  }

  public async reject(userId: number, approvalId: number): Promise<DecisionResult> {
    if (!this.deps.auth.canApprove(userId)) {
      return { reply: 'only the owner can reject.' };
    }

    const approval = await this.deps.repository.getApproval(approvalId);
    if (!approval) {
      return { reply: `approval #${approvalId} not found.` };
    }
    const decided = await this.deps.repository.decideApproval(approvalId, 'rejected', userId);
    if (!decided) {
      return { reply: `approval #${approvalId} not found or already decided.` };
    }
    await this.editApproval(
      decided,
      `❌ Approval #${approvalId} rejected\n${decided.summary}\n\n${approvalContext(decided).join('\n')}`,
    );
    await this.notifySource(decided, '❌ Your request was rejected.');
    return { reply: `approval #${approvalId} rejected.` };
  }

  private async editApproval(approval: Approval, text: string, approvalId?: number): Promise<void> {
    if (approval.approvalChatId && approval.approvalMessageId) {
      const edited = await this.deps.reporter.editProposal(
        approval.approvalChatId,
        approval.approvalMessageId,
        text,
        approvalId,
      );
      if (edited) return;
    }
    const posted = await this.deps.reporter.postProposal(text, approvalId);
    if (posted) {
      await this.deps.repository.setApprovalMessageRef(
        approval.id,
        posted.chatId,
        posted.messageId,
      );
    }
  }

  private async notifySource(
    approval: Approval,
    status: string,
    finalResult?: string,
  ): Promise<void> {
    approval = (await this.deps.repository.getApproval(approval.id)) ?? approval;
    if (!approval.sourceChatId || !approval.sourceMessageId) return;
    const link =
      approval.approvalChatId && approval.approvalMessageId
        ? telegramMessageLink(approval.approvalChatId, approval.approvalMessageId)
        : null;
    const update = `Approval #${approval.id}: ${status}${link ? `\n${link}` : ''}`;
    if (approval.sourceReplyMessageId && approval.sourceReplyText) {
      const edited = finalResult
        ? await this.deps.reporter.replaceSource(
            approval.sourceChatId,
            approval.sourceReplyMessageId,
            finalResult,
          )
        : await this.deps.reporter.editSource(
            approval.sourceChatId,
            approval.sourceReplyMessageId,
            approval.sourceReplyText,
            update,
          );
      if (edited) return;
    }
    await this.deps.reporter.notifySource(approval.sourceChatId, approval.sourceMessageId, update);
  }
}
