import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutor } from '../src/agent/executor.js';
import { AgentRunner, validatePatch } from '../src/agent/runner.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe('AgentRunner', () => {
  const config = {
    GITHUB_TOKEN: undefined,
    GITHUB_REPO: undefined,
    GITHUB_DEFAULT_BRANCH: 'main',
    MAX_AGENT_STEPS: 10,
    MAX_ACTIVE_RUNS_PER_USER: 2,
    MAX_CONCURRENT_AGENT_RUNS: 1,
    ENABLE_SELF_MODIFICATION: true,
    ENABLE_AUTOMATIC_RESTART: false,
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
    );

    const result = await runner.execute(
      'do the thing',
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
    );

    await expect(runner.plan('thing')).resolves.toMatchObject({ branch: 'jynx/bad-branch' });
  });

  it('blocks paths outside the repository and secrets without blocking project configuration', () => {
    expect(() =>
      validatePatch('--- a/src/a.ts\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b'),
    ).toThrow('unsafe patch path');
    expect(() => validatePatch('--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-a\n+b')).toThrow(
      'blocked patch path',
    );
    expect(() =>
      validatePatch('--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-{}\n+{"type":"module"}'),
    ).not.toThrow();
  });

  it('returns a database inspection result without touching Git', async () => {
    const repository = {
      createTask: vi.fn(async () => ({ id: 3 })),
      countActiveRunsForUser: vi.fn(async () => 1),
      updateTask: vi.fn(async () => {}),
    };
    const github = { createBranch: vi.fn(), push: vi.fn(), openPullRequest: vi.fn() };
    const model = {
      complete: vi.fn(async () => ({ content: 'there are 4 pending approvals' })),
    };
    const introspection = {
      isEnabled: true,
      dbOverview: vi.fn(async () => ({ pendingApprovals: 4 })),
    };
    const runner = new AgentRunner(
      config,
      repository as never,
      model as never,
      {} as never,
      logger,
      undefined,
      introspection as never,
    );

    const result = await runner.executeAction('check the database approvals', ['db.stats'], 42);

    expect(result).toMatchObject({ status: 'done', output: 'there are 4 pending approvals' });
    expect(introspection.dbOverview).toHaveBeenCalledOnce();
    expect(github.createBranch).not.toHaveBeenCalled();
    expect(github.openPullRequest).not.toHaveBeenCalled();
  });

  it('loads tracked context, applies a model patch, validates it, and reaches PR creation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maple-edit-'));
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/value.ts'), 'export const value = 1;\n');
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: root });
    const real = new CommandExecutor(
      { allowedCommands: ['git', 'npm'], timeoutMs: 5000, workdir: root },
      logger,
    );
    const executor = {
      run: real.run.bind(real),
      writeFile: real.writeFile.bind(real),
      runChecked: vi.fn(async (command: string, args: string[]) =>
        command === 'npm'
          ? { command, args, exitCode: 0, stdout: '', stderr: '' }
          : real.runChecked(command, args),
      ),
      scoped: vi.fn(() => executor),
      cleanup: vi.fn(),
    };
    const repository = {
      createTask: vi.fn(async () => ({ id: 1 })),
      countActiveRunsForUser: vi.fn(async () => 1),
      updateTask: vi.fn(async () => {}),
    };
    const model = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({ content: '{"files":["src/value.ts"]}' })
        .mockResolvedValueOnce({
          content:
            '<patch>\ndiff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n</patch>',
        }),
    };
    const github = {
      isConfigured: true,
      createBranch: vi.fn(async (branch: string) => {
        await real.runChecked('git', ['checkout', '-b', branch]);
      }),
      commitAll: vi.fn(async () => {}),
      push: vi.fn(async () => {}),
      openPullRequest: vi.fn(async () => ({ url: 'https://example.test/pr/1', number: 1 })),
    };
    const requestDeployment = vi.fn(async () => {});
    const runner = new AgentRunner(
      {
        ...config,
        GITHUB_TOKEN: 'token',
        GITHUB_REPO: 'o/r',
        ENABLE_AUTOMATIC_RESTART: true,
      },
      repository as never,
      model as never,
      executor as never,
      logger,
      undefined,
      undefined,
      () => github as never,
      requestDeployment,
    );

    const result = await runner.execute(
      'change the value\nRecent context: private conversation must stay private',
      'change the value',
      { branch: 'jynx/change', summary: 'change value', steps: ['edit value'], testPlan: [] },
      42,
    );

    expect(result).toMatchObject({
      status: 'done',
      prUrl: 'https://example.test/pr/1',
      deploymentRequested: true,
    });
    expect(readFileSync(path.join(root, 'src/value.ts'), 'utf8')).toBe('export const value = 2;\n');
    expect(github.openPullRequest).toHaveBeenCalledOnce();
    expect(github.openPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.not.stringContaining('private conversation') }),
    );
    expect(requestDeployment).toHaveBeenCalledWith({ prNumber: 1, branch: 'jynx/change' });
  });
});
