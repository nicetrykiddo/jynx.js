import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../core/logger.js';

export interface ExecutorConfig {
  allowedCommands: string[];
  timeoutMs: number;
  workdir: string;
}

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CommandNotAllowedError extends Error {
  public constructor(command: string) {
    super(`command not allowed: ${command}`);
    this.name = 'CommandNotAllowedError';
  }
}

export class PathEscapeError extends Error {
  public constructor(target: string) {
    super(`path escapes workdir: ${target}`);
    this.name = 'PathEscapeError';
  }
}

const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r\\]|\|\||&&/;

function assertWithinWorkdir(workdir: string, target: string): void {
  const resolvedWorkdir = path.resolve(workdir);
  const resolvedTarget = path.resolve(resolvedWorkdir, target);
  if (resolvedTarget !== resolvedWorkdir && !resolvedTarget.startsWith(resolvedWorkdir + path.sep)) {
    throw new PathEscapeError(target);
  }
}

export class CommandExecutor {
  private readonly allowed: Set<string>;

  public constructor(
    private readonly config: ExecutorConfig,
    private readonly logger: Logger,
  ) {
    this.allowed = new Set(config.allowedCommands);
  }

  public isAllowed(command: string): boolean {
    return this.allowed.has(command);
  }

  public assertPath(target: string): void {
    assertWithinWorkdir(this.config.workdir, target);
  }

  public async run(command: string, args: string[] = []): Promise<CommandResult> {
    if (!this.allowed.has(command)) {
      throw new CommandNotAllowedError(command);
    }

    for (const arg of args) {
      if (SHELL_METACHARACTERS.test(arg)) {
        throw new CommandNotAllowedError(`${command} (unsafe argument: ${arg})`);
      }
    }

    this.logger.info({ command, args }, 'executor run');

    const cwd = path.resolve(this.config.workdir);
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`command timed out: ${command}`));
      }, this.config.timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        const err = error as { code?: string };
        if (err.code === 'ENOENT') {
          reject(new Error(`command not found on host: ${command} (is it installed and on PATH?)`));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ command, args, exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}
