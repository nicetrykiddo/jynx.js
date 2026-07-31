import type { Logger } from '../core/logger.js';
import type { Reporter } from '../core/reporter.js';
import type { Repository } from '../storage/repository.js';
import type { IntentDetector } from './intent.js';
import type { AgentRunner } from './runner.js';
import { telegramMessageLink } from '../core/reporter.js';
import type { Role } from '../core/auth.js';
import { requiresTrustedChannel } from '../core/capabilities.js';
import type { AppConfig } from '../config.js';

export interface ProposalServiceDeps {
  repository: Repository;
  reporter: Reporter;
  intent: IntentDetector;
  runner: AgentRunner;
  logger: Logger;
  config: Pick<AppConfig, 'MAX_PROPOSALS_PER_USER_PER_HOUR'>;
}

export class ProposalService {
  public constructor(private readonly deps: ProposalServiceDeps) {}

  public async considerMessage(input: {
    userId: number | null;
    requestedByName: string;
    chatId: number;
    messageId: number;
    text: string;
    requesterRole: Role;
    trustedChannel: boolean;
    assistantReply: string;
  }): Promise<{ approvalId: number; link: string | null } | null> {
    if (
      input.userId !== null &&
      (await this.deps.repository.countRecentApprovalsForUser(input.userId, 60 * 60 * 1000)) >=
        this.deps.config.MAX_PROPOSALS_PER_USER_PER_HOUR
    ) {
      this.deps.logger.warn({ userId: input.userId }, 'proposal rate limit reached');
      return null;
    }
    const history = await this.deps.repository.getRecentMessages(input.chatId, 12);
    const recentContext = history
      .filter((message) => message.role !== 'user' || message.telegramMessageId !== input.messageId)
      .slice(-11)
      .map((message) => {
        const metadata = (message.metadata ?? {}) as { displayName?: string };
        const name = message.role === 'assistant' ? 'Jynx' : (metadata.displayName ?? 'user');
        return `${name}: ${message.content}`;
      })
      .join('\n');
    const detected = await this.deps.intent.detect(input.text, {
      recentContext,
      requesterRole: input.requesterRole,
      trustedChannel: input.trustedChannel,
      assistantReply: input.assistantReply,
    });
    if (!detected.isProposal) {
      return null;
    }
    if (requiresTrustedChannel(detected.capabilities) && !input.trustedChannel) return null;

    const approval = await this.deps.repository.createApproval({
      requestedBy: input.userId,
      requestedByName: input.requestedByName,
      kind: detected.kind,
      stage: 'idea',
      summary: detected.title,
      payload: {
        capabilities: detected.capabilities,
        trustedChannel: input.trustedChannel,
        requesterRole: input.requesterRole,
        publicRequest: `${detected.summary}\nLatest request: ${input.text}`,
        summary: detected.summary,
        idea: [
          detected.summary,
          `Latest request: ${input.text}`,
          ...(recentContext ? [`Recent context:\n${recentContext}`] : []),
        ].join('\n\n'),
      },
      sourceChatId: input.chatId,
      sourceMessageId: input.messageId,
    });

    const text = [
      `Proposal #${approval.id} (${detected.kind})`,
      detected.title,
      '',
      detected.summary,
      `Capabilities: ${detected.capabilities.join(', ') || 'none'}`,
      `Latest request: ${input.text.slice(0, 1000)}`,
      '',
      `Requested by: ${input.requestedByName} (${input.userId ?? 'unknown'})`,
      ...(telegramMessageLink(input.chatId, input.messageId)
        ? [`Source message: ${telegramMessageLink(input.chatId, input.messageId)}`]
        : []),
      '',
      'Tap a button below to plan it or drop it.',
    ].join('\n');

    const posted = await this.deps.reporter.postProposal(text, approval.id);
    if (!posted) {
      return { approvalId: approval.id, link: null };
    }
    await this.deps.repository.setApprovalMessageRef(approval.id, posted.chatId, posted.messageId);
    return { approvalId: approval.id, link: posted.link };
  }
}
