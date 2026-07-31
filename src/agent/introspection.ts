import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import type { Repository } from '../storage/repository.js';

export interface IntrospectionDeps {
  config: Pick<AppConfig, 'ENABLE_OWNER_INTROSPECTION' | 'INTROSPECTION_ROOT'>;
  repository: Repository;
  logger: Logger;
}

export interface DbOverview {
  chats: number;
  users: number;
  messages: number;
  memories: number;
  tasks: number;
  approvals: number;
  pendingApprovals: number;
}

const MAX_FILE_BYTES = 60_000;

export class IntrospectionService {
  public constructor(private readonly deps: IntrospectionDeps) {}

  public get isEnabled(): boolean {
    return this.deps.config.ENABLE_OWNER_INTROSPECTION;
  }

  private get root(): string {
    return path.resolve(this.deps.config.INTROSPECTION_ROOT);
  }

  private resolveWithin(target: string): string {
    const root = realpathSync(this.root);
    const resolved = path.resolve(root, target);
    const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (real !== root && !real.startsWith(root + path.sep)) {
      throw new Error(`path escapes project root: ${target}`);
    }
    return real;
  }

  public readOwnFile(relativePath: string): string {
    if (!this.isEnabled) {
      throw new Error('introspection is disabled');
    }
    const blocked = ['.env', 'node_modules', '.git'];
    const normalized = relativePath.replace(/\\/g, '/');
    if (
      blocked.some(
        (b) => normalized === b || normalized.startsWith(`${b}/`) || normalized.includes(`/${b}/`),
      )
    ) {
      throw new Error('that path is off-limits (secrets/internals)');
    }
    const resolved = this.resolveWithin(relativePath);
    if (!existsSync(resolved)) {
      throw new Error(`file not found: ${relativePath}`);
    }
    const content = readFileSync(resolved, 'utf8');
    return content.length > MAX_FILE_BYTES
      ? content.slice(0, MAX_FILE_BYTES) + '\n... (truncated)'
      : content;
  }

  public listOwnFiles(relativeDir = '.'): string[] {
    if (!this.isEnabled) {
      throw new Error('introspection is disabled');
    }
    const resolved = this.resolveWithin(relativeDir);
    if (!existsSync(resolved)) {
      throw new Error(`directory not found: ${relativeDir}`);
    }
    const entries = readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter(
        (e) => !['node_modules', '.git', '.env'].includes(e.name) && !e.name.startsWith('.env'),
      )
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  }

  public async dbOverview(): Promise<DbOverview> {
    if (!this.isEnabled) {
      throw new Error('introspection is disabled');
    }
    return this.deps.repository.getDbOverview();
  }
}
