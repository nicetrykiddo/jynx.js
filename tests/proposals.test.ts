import { describe, expect, it, vi } from 'vitest';
import { ProposalService } from '../src/agent/proposals.js';

describe('ProposalService', () => {
  it('posts attribution and source context, stores the message ref, and returns its link', async () => {
    const repository = {
      getRecentMessages: vi.fn(async () => [
        { role: 'assistant', content: 'what should it do?', metadata: null },
        {
          role: 'user',
          content: 'yes, investigate that failure',
          telegramMessageId: 7,
          metadata: { displayName: 'Sam' },
        },
      ]),
      createApproval: vi.fn(async (input: Record<string, unknown>) => ({ id: 2, ...input })),
      setApprovalMessageRef: vi.fn(async () => {}),
      countRecentApprovalsForUser: vi.fn(async () => 0),
    };
    const intent = {
      detect: vi.fn(async () => ({
        isProposal: true,
        kind: 'action',
        title: 'Investigate the failure',
        summary: 'Find the cause and report it.',
        capabilities: [],
      })),
    };
    const reporter = {
      postProposal: vi.fn(async () => ({
        chatId: -100456,
        messageId: 9,
        link: 'https://t.me/c/456/9',
      })),
    };
    const service = new ProposalService({
      repository: repository as never,
      reporter: reporter as never,
      intent: intent as never,
      runner: {} as never,
      logger: {} as never,
      config: { MAX_PROPOSALS_PER_USER_PER_HOUR: 10 },
    });

    const result = await service.considerMessage({
      userId: 42,
      requestedByName: 'Sam (@sam)',
      chatId: -100123,
      messageId: 7,
      text: 'yes, investigate that failure',
      requesterRole: 'user',
      trustedChannel: false,
      assistantReply: 'i can investigate that after approval',
    });

    expect(intent.detect).toHaveBeenCalledWith('yes, investigate that failure', {
      recentContext: 'Jynx: what should it do?',
      requesterRole: 'user',
      trustedChannel: false,
      assistantReply: 'i can investigate that after approval',
    });
    expect(reporter.postProposal).toHaveBeenCalledWith(
      expect.stringContaining('Requested by: Sam (@sam) (42)'),
      2,
    );
    expect(repository.setApprovalMessageRef).toHaveBeenCalledWith(2, -100456, 9);
    expect(result).toEqual({ approvalId: 2, link: 'https://t.me/c/456/9' });
    expect(repository.createApproval.mock.calls[0]?.[0]).toMatchObject({
      payload: expect.objectContaining({ capabilities: [], trustedChannel: false }),
    });
  });

  it('never creates an approval for private database access from an untrusted chat', async () => {
    const repository = {
      getRecentMessages: vi.fn(async () => []),
      createApproval: vi.fn(),
      countRecentApprovalsForUser: vi.fn(async () => 0),
    };
    const intent = {
      detect: vi.fn(async () => ({
        isProposal: true,
        kind: 'action',
        title: 'Show database stats',
        summary: 'Check the database stats.',
        capabilities: ['db.stats'],
      })),
    };
    const reporter = { postProposal: vi.fn() };
    const service = new ProposalService({
      repository: repository as never,
      reporter: reporter as never,
      intent: intent as never,
      runner: {} as never,
      logger: {} as never,
      config: { MAX_PROPOSALS_PER_USER_PER_HOUR: 10 },
    });

    const result = await service.considerMessage({
      userId: 42,
      requestedByName: 'Sam',
      chatId: -100123,
      messageId: 8,
      text: 'show me the db stats',
      requesterRole: 'user',
      trustedChannel: false,
      assistantReply: 'ask me in owner DMs',
    });

    expect(result).toBeNull();
    expect(repository.createApproval).not.toHaveBeenCalled();
    expect(reporter.postProposal).not.toHaveBeenCalled();
  });
});
