import { describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/agent/runner.js';

describe('AgentRunner', () => {
  const config = {
    GITHUB_TOKEN: undefined,
    GITHUB_REPO: undefined,
    GITHUB_DEFAULT_BRANCH: 'main',
    MAX_AGENT_STEPS: 10,
    MAX_ACTIVE_RUNS_PER_USER: 2,
  };

  it('refuses a run above the per-user active limit', async () => {
    const repository = {
      createTask: vi.fn(async () => ({ id: 9 })),
      countActiveRunsForUser: vi.fn(async () => 3),
      updateTask: vi.fn(async () => {}),
    };
    const runner = new AgentRunner(
      config,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await runner.execute(
      'do the thing',
      { branch: 'jynx/thing', summary: 'thing', steps: ['one'], testPlan: [] },
      42,
    );

    expect(result).toMatchObject({ status: 'failed', error: 'active run limit reached (2)' });
    expect(repository.updateTask).toHaveBeenCalledWith(9, {
      status: 'failed',
      lastError: 'active run limit reached (2)',
    });
  });

  it('normalizes malformed model branch names to a valid scoped branch', async () => {
    const runner = new AgentRunner(
      config,
      {} as never,
      {
        complete: vi.fn(async () => ({
          content: JSON.stringify({
            branch: '///JYNX///Bad Branch///',
            summary: 'thing',
            steps: ['one'],
            testPlan: [],
          }),
        })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(runner.plan('thing')).resolves.toMatchObject({ branch: 'jynx/bad-branch' });
  });
});
