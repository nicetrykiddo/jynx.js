import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
const MAX_OUTPUT_CHARS = 1_000_000;

function redactText(value: string): string {
  return value.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@');
}

export function redactCommandArgs(args: string[]): string[] {
  return args.map(redactText);
}

function assertWithinWorkdir(workdir: string, target: string): void {
  const lexicalWorkdir = path.resolve(workdir);
  const resolvedWorkdir = existsSync(lexicalWorkdir)
    ? realpathSync(lexicalWorkdir)
    : lexicalWorkdir;
  const lexicalTarget = path.resolve(lexicalWorkdir, target);
  const existingTarget = existsSync(lexicalTarget) ? realpathSync(lexicalTarget) : null;
  const parent = path.dirname(lexicalTarget);
  const resolvedParent = existsSync(parent) ? realpathSync(parent) : parent;
  const resolvedTarget = existingTarget ?? path.join(resolvedParent, path.basename(lexicalTarget));
  if (
    resolvedTarget !== resolvedWorkdir &&
    !resolvedTarget.startsWith(resolvedWorkdir + path.sep)
  ) {
    throw new PathEscapeError(target);
  }
}

export class CommandExecutor {
  private readonly allowed: Set<string>;

  public constructor(
    private readonly config: ExecutorConfig,
    private readonly logger: Logger,
    private readonly disposable = false,
  ) {
    this.allowed = new Set(config.allowedCommands);
  }

  public isAllowed(command: string): boolean {
    return this.allowed.has(command);
  }

  public assertPath(target: string): void {
    assertWithinWorkdir(this.config.workdir, target);
  }

  public get workdir(): string {
    return path.resolve(this.config.workdir);
  }

  public scoped(segment: string): CommandExecutor {
    if (!/^\d+$/.test(segment)) throw new PathEscapeError(segment);
    return new CommandExecutor(
      { ...this.config, workdir: path.join(this.workdir, 'runs', segment) },
      this.logger,
      true,
    );
  }

  public writeFile(target: string, content: string, mode?: number): void {
    this.assertPath(target);
    const resolved = path.resolve(this.config.workdir, target);
    writeFileSync(resolved, content, 'utf8');
    if (mode !== undefined) chmodSync(resolved, mode);
  }

  public removeFile(target: string): void {
    this.assertPath(target);
    const resolved = path.resolve(this.config.workdir, target);
    if (existsSync(resolved)) unlinkSync(resolved);
  }

  public cleanupAbandonedRuns(): void {
    const runs = path.join(this.workdir, 'runs');
    assertWithinWorkdir(this.workdir, runs);
    rmSync(runs, { recursive: true, force: true });
  }

  public cleanup(): void {
    if (!this.disposable) throw new Error('refusing to remove a non-disposable workdir');
    rmSync(this.workdir, { recursive: true, force: true });
  }

  public async run(
    command: string,
    args: string[] = [],
    environment: Record<string, string> = {},
  ): Promise<CommandResult> {
    if (!this.allowed.has(command)) {
      throw new CommandNotAllowedError(command);
    }

    for (const arg of args) {
      if (SHELL_METACHARACTERS.test(arg)) {
        throw new CommandNotAllowedError(`${command} (unsafe argument: ${arg})`);
      }
    }

    const safeArgs = redactCommandArgs(args);
    this.logger.info({ command, args: safeArgs }, 'executor run');

    const cwd = path.resolve(this.config.workdir);
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }
    const cache = path.join(tmpdir(), 'maple-npm-cache');
    mkdirSync(cache, { recursive: true });

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          PATH: process.env.PATH,
          LANG: process.env.LANG ?? 'C.UTF-8',
          HOME: cwd,
          CI: '1',
          GIT_TERMINAL_PROMPT: '0',
          npm_config_cache: cache,
          ...environment,
        },
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`command timed out: ${command}`));
      }, this.config.timeoutMs);

      child.stdout.on('data', (chunk) => {
        // ponytail: cap buffered output; stream to files if full command logs become necessary.
        stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
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
        resolve({ command, args: safeArgs, exitCode: code ?? -1, stdout, stderr });
      });
    });
  }

  public async runChecked(
    command: string,
    args: string[] = [],
    environment: Record<string, string> = {},
  ): Promise<CommandResult> {
    const result = await this.run(command, args, environment);
    if (result.exitCode !== 0) {
      throw new Error(
        `${command} failed (${result.exitCode}): ${redactText(result.stderr || result.stdout).slice(0, 300)}`,
      );
    }
    return result;
  }
}
