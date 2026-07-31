import { describe, expect, it, vi } from 'vitest';
import { ApprovalFlow } from '../src/agent/approval-flow.js';
import { AuthService } from '../src/core/auth.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as import('../src/core/logger.js').Logger;

function makeAuth() {
  return new AuthService({ JYNX_OWNER_ID: 100, JYNX_ADMIN_IDS: [100, 200] });
}

interface FakeApproval {
  id: number;
  requestedBy: number | null;
  kind: string;
  stage: string;
  summary: string;
  payload: unknown;
  status: string;
  approvalChatId?: number | null;
  approvalMessageId?: number | null;
  sourceChatId?: number | null;
  sourceMessageId?: number | null;
  requestedByName?: string | null;
}

function makeDeps(overrides: Partial<{ approval: FakeApproval }> = {}) {
  const approvals = new Map<number, FakeApproval>();
  if (overrides.approval) {
    approvals.set(overrides.approval.id, overrides.approval);
  }
  const repository = {
    getApproval: vi.fn(async (id: number) => approvals.get(id)),
    decideApproval: vi.fn(async (id: number, status: string, decidedBy: number) => {
      const row = approvals.get(id);
      if (!row || row.status !== 'pending') return undefined;
      row.status = status;
      return { ...row, decidedBy };
    }),
    updateApprovalStagePlan: vi.fn(async (id: number, summary: string, payload: unknown) => {
      const row = approvals.get(id);
      if (!row || row.status !== 'pending' || row.stage !== 'idea') return undefined;
      row.stage = 'plan';
      row.summary = summary;
      row.payload = payload;
      return row;
    }),
  };

  const reporter = {
    editProposal: vi.fn(async () => true),
    postProposal: vi.fn(async () => undefined),
  };
  const runner = {
    plan: vi.fn(async () => ({
      branch: 'jynx/test',
      summary: 'test plan',
      steps: ['step one'],
      testPlan: ['run tests'],
    })),
    execute: vi.fn(async () => ({ taskId: 1, status: 'done' as const, prUrl: 'http://pr' })),
  };

  return { repository, reporter, runner, approvals };
}

describe('ApprovalFlow', () => {
  it('rejects approval from non-owner', async () => {
    const deps = makeDeps({
      approval: {
        id: 1,
        requestedBy: 300,
        kind: 'feature',
        stage: 'idea',
        summary: 'idea',
        payload: { idea: 'do a thing' },
        status: 'pending',
      },
    });
    const flow = new ApprovalFlow({
      config: { GITHUB_REPO: 'o/r' },
      auth: makeAuth(),
      repository: deps.repository as never,
      reporter: deps.reporter as never,
      runner: deps.runner as never,
      logger,
    });
    const result = await flow.approve(200, 1);
    expect(result.reply).toContain('only the owner');
    expect(deps.runner.plan).not.toHaveBeenCalled();
  });

  it('turns an idea into a plan on the same approval and message', async () => {
    const deps = makeDeps({
      approval: {
        id: 1,
        requestedBy: 300,
        kind: 'feature',
        stage: 'idea',
        summary: 'idea',
        payload: { idea: 'do a thing' },
        status: 'pending',
        approvalChatId: -100123,
        approvalMessageId: 55,
      },
    });
    const flow = new ApprovalFlow({
      config: { GITHUB_REPO: 'o/r' },
      auth: makeAuth(),
      repository: deps.repository as never,
      reporter: deps.reporter as never,
      runner: deps.runner as never,
      logger,
    });
    const result = await flow.approve(100, 1);
    expect(deps.runner.plan).toHaveBeenCalledOnce();
    expect(result.reply).toContain('approval #1 is now a plan');
    expect(deps.approvals.size).toBe(1);
    expect(deps.approvals.get(1)?.stage).toBe('plan');
    expect(deps.reporter.editProposal).toHaveBeenCalledWith(
      -100123,
      55,
      expect.stringContaining('Approval #1 — plan ready'),
      1,
    );
  });
});
