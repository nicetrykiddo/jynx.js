import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/core/logger.js';

describe('redactSecrets', () => {
  it('redacts secret-like keys', () => {
    const input = {
      token: 'abc123',
      apiKey: 'secretvalue',
      DATABASE_URL: 'postgres://u:p@host/db',
      normal: 'keep me',
    };
    const output = redactSecrets(input);
    expect(output.token).toBe('[redacted]');
    expect(output.apiKey).toBe('[redacted]');
    expect(output.DATABASE_URL).toBe('[redacted]');
    expect(output.normal).toBe('keep me');
  });

  it('redacts nested and array values', () => {
    const input = { outer: { password: 'hunter2' }, list: [{ authorization: 'Bearer x' }] };
    const output = redactSecrets(input);
    expect(output.outer.password).toBe('[redacted]');
    expect(output.list[0]?.authorization).toBe('[redacted]');
  });
});
