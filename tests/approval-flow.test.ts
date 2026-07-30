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
}

function makeDeps(overrides: Partial<{ approval: FakeApproval }> = {}) {
  const approvals = new Map<number, FakeApproval>();
  if (overrides.approval) {
    approvals.set(overrides.approval.id, overrides.approval);
  }
  let nextId = 2;

  const repository = {
    getApproval: vi.fn(async (id: number) => approvals.get(id)),
    decideApproval: vi.fn(async (id: number, status: string, decidedBy: number) => {
      const row = approvals.get(id);
      if (!row || row.status !== 'pending') return undefined;
      row.status = status;
      return { ...row, decidedBy };
    }),
    createApproval: vi.fn(async (input: Record<string, unknown>) => {
      const row: FakeApproval = {
        id: nextId++,
        requestedBy: (input.requestedBy as number) ?? null,
        kind: input.kind as string,
        stage: (input.stage as string) ?? 'idea',
        summary: input.summary as string,
        payload: input.payload,
        status: 'pending',
      };
      approvals.set(row.id, row);
      return row;
    }),
  };

  const reporter = { postProposal: vi.fn(async () => {}) };
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

  it('idea approval drafts a plan and creates plan approval', async () => {
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
    const result = await flow.approve(100, 1);
    expect(deps.runner.plan).toHaveBeenCalledOnce();
    expect(result.reply).toContain('drafted plan');
    expect(deps.reporter.postProposal).toHaveBeenCalledOnce();
  });
});
