import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntrospectionService } from '../src/agent/introspection.js';

describe('IntrospectionService', () => {
  it('blocks symlinks that escape the project root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maple-root-'));
    const outside = path.join(mkdtempSync(path.join(tmpdir(), 'maple-outside-')), 'secret');
    writeFileSync(outside, 'hidden');
    symlinkSync(outside, path.join(root, 'shortcut'));
    const service = new IntrospectionService({
      config: { ENABLE_OWNER_INTROSPECTION: true, INTROSPECTION_ROOT: root },
      repository: {} as never,
      logger: {} as never,
    });

    expect(() => service.readOwnFile('shortcut')).toThrow('path escapes project root');
  });

  it('blocks environment variants and private-key files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maple-sensitive-'));
    writeFileSync(path.join(root, '.env.production'), 'TOKEN=secret');
    writeFileSync(path.join(root, 'server.pem'), 'secret');
    const service = new IntrospectionService({
      config: { ENABLE_OWNER_INTROSPECTION: true, INTROSPECTION_ROOT: root },
      repository: {} as never,
      logger: {} as never,
    });

    expect(() => service.readOwnFile('.env.production')).toThrow('off-limits');
    expect(() => service.readOwnFile('server.pem')).toThrow('off-limits');
    expect(service.listOwnFilesRecursive()).toEqual([]);
  });
});
