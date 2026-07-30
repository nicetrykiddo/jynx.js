import type { AppConfig } from '../config.js';
import type { AuthService } from '../core/auth.js';
import type { Logger } from '../core/logger.js';
import type { Reporter } from '../core/reporter.js';
import type { Repository } from '../storage/repository.js';
import type { AgentPlan, AgentRunner } from './runner.js';

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

    if (approval.stage === 'idea') {
      return this.approveIdea(userId, approvalId);
    }
    if (approval.stage === 'plan') {
      return this.approvePlan(userId, approvalId);
    }
    return { reply: `approval #${approvalId} is in an unknown stage.` };
  }

  private async approveIdea(userId: number, approvalId: number): Promise<DecisionResult> {
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

    await this.deps.repository.decideApproval(approvalId, 'approved', userId);

    const planApproval = await this.deps.repository.createApproval({
      requestedBy: approval.requestedBy,
      kind: approval.kind,
      stage: 'plan',
      summary: plan.summary.slice(0, 120),
      payload: { idea, plan },
    });

    const text = [
      `Plan #${planApproval.id} for idea #${approvalId}`,
      `branch: ${plan.branch}`,
      '',
      'steps:',
      ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      'tests:',
      ...plan.testPlan.map((s) => `- ${s}`),
      '',
      'Tap a button below to build it or drop it.',
    ].join('\n');

    await this.deps.reporter.postProposal(text, planApproval.id);
    return { reply: `idea #${approvalId} approved. drafted plan #${planApproval.id}.` };
  }

  private async approvePlan(userId: number, approvalId: number): Promise<DecisionResult> {
    const approval = await this.deps.repository.getApproval(approvalId);
    if (!approval) {
      return { reply: `approval #${approvalId} not found.` };
    }

    const payload = asPlanPayload(approval.payload);
    const plan = payload.plan;
    const idea = payload.idea ?? payload.summary ?? approval.summary;

    if (!plan) {
      return { reply: `approval #${approvalId} has no plan payload.` };
    }

    await this.deps.repository.decideApproval(approvalId, 'approved', userId);

    void this.runInBackground(idea, plan, approval.requestedBy ?? null, approvalId);

    return { reply: `plan #${approvalId} approved. building on branch ${plan.branch}, i'll post the PR when it's up.` };
  }

  private async runInBackground(
    idea: string,
    plan: AgentPlan,
    requestedBy: number | null,
    approvalId: number,
  ): Promise<void> {
    try {
      const result = await this.deps.runner.execute(idea, plan, requestedBy);
      if (result.status === 'done') {
        await this.deps.reporter.postProposal(
          `Plan #${approvalId} built. PR: ${result.prUrl ?? '(no url)'}`,
        );
      } else {
        await this.deps.reporter.postProposal(
          `Plan #${approvalId} failed: ${(result.error ?? 'unknown').slice(0, 300)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ err: message, approvalId }, 'background run failed');
      await this.deps.reporter.postProposal(`Plan #${approvalId} crashed: ${message.slice(0, 300)}`);
    }
  }

  public async reject(userId: number, approvalId: number): Promise<DecisionResult> {
    if (!this.deps.auth.canApprove(userId)) {
      return { reply: 'only the owner can reject.' };
    }

    const decided = await this.deps.repository.decideApproval(approvalId, 'rejected', userId);
    if (!decided) {
      return { reply: `approval #${approvalId} not found or already decided.` };
    }
    return { reply: `approval #${approvalId} rejected.` };
  }
}
