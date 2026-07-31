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
const SENSITIVE_NAMES = new Set([
  'credentials.json',
  'service-account.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

function isSensitivePath(value: string): boolean {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some(
      (segment) =>
        segment === '.git' ||
        segment === 'node_modules' ||
        segment.startsWith('.env') ||
        SENSITIVE_NAMES.has(segment.toLowerCase()) ||
        /\.(?:pem|key|p12|pfx)$/i.test(segment),
    );
}

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
    const normalized = relativePath.replace(/\\/g, '/');
    if (isSensitivePath(normalized)) {
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
      .filter((e) => !isSensitivePath(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  }

  public listOwnFilesRecursive(relativeDir = '.'): string[] {
    if (!this.isEnabled) {
      throw new Error('introspection is disabled');
    }
    const projectRoot = realpathSync(this.root);
    const root = this.resolveWithin(relativeDir);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.isSymbolicLink() ||
          ['node_modules', '.git', 'dist'].includes(entry.name) ||
          isSensitivePath(entry.name)
        ) {
          continue;
        }
        const absolute = this.resolveWithin(path.relative(projectRoot, path.join(dir, entry.name)));
        if (entry.isDirectory()) walk(absolute);
        else files.push(path.relative(projectRoot, absolute).replace(/\\/g, '/'));
      }
    };
    walk(root);
    return files.sort();
  }

  public async dbOverview(): Promise<DbOverview> {
    if (!this.isEnabled) {
      throw new Error('introspection is disabled');
    }
    return this.deps.repository.getDbOverview();
  }
}
