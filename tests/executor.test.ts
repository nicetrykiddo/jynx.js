import { describe, expect, it, vi } from 'vitest';
import {
  CommandExecutor,
  CommandNotAllowedError,
  PathEscapeError,
} from '../src/agent/executor.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as import('../src/core/logger.js').Logger;

function makeExecutor() {
  return new CommandExecutor(
    { allowedCommands: ['git', 'npm', 'echo'], timeoutMs: 5000, workdir: '.jynx-work' },
    logger,
  );
}

describe('CommandExecutor', () => {
  it('reports allowed commands', () => {
    const executor = makeExecutor();
    expect(executor.isAllowed('git')).toBe(true);
    expect(executor.isAllowed('rm')).toBe(false);
    expect(executor.isAllowed('curl')).toBe(false);
  });

  it('rejects disallowed commands at run time', async () => {
    const executor = makeExecutor();
    await expect(executor.run('curl', ['https://evil'])).rejects.toBeInstanceOf(
      CommandNotAllowedError,
    );
  });

  it('rejects arguments with shell metacharacters', async () => {
    const executor = makeExecutor();
    await expect(executor.run('git', ['status; rm -rf /'])).rejects.toBeInstanceOf(
      CommandNotAllowedError,
    );
  });

  it('blocks paths escaping the workdir', () => {
    const executor = makeExecutor();
    expect(() => executor.assertPath('../../etc/passwd')).toThrow(PathEscapeError);
    expect(() => executor.assertPath('src/file.ts')).not.toThrow();
  });
});
