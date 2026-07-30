import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/core/auth.js';

const config = { JYNX_OWNER_ID: 100, JYNX_ADMIN_IDS: [100, 200] };

describe('AuthService', () => {
  it('identifies the owner', () => {
    const auth = new AuthService(config);
    const identity = auth.identify(100);
    expect(identity.isOwner).toBe(true);
    expect(identity.isAdmin).toBe(true);
    expect(identity.role).toBe('owner');
  });

  it('identifies an admin', () => {
    const auth = new AuthService(config);
    const identity = auth.identify(200);
    expect(identity.isOwner).toBe(false);
    expect(identity.isAdmin).toBe(true);
    expect(identity.role).toBe('admin');
  });

  it('identifies a regular user', () => {
    const auth = new AuthService(config);
    const identity = auth.identify(300);
    expect(identity.isOwner).toBe(false);
    expect(identity.isAdmin).toBe(false);
    expect(identity.role).toBe('user');
  });

  it('only the owner can approve', () => {
    const auth = new AuthService(config);
    expect(auth.canApprove(100)).toBe(true);
    expect(auth.canApprove(200)).toBe(false);
    expect(auth.canApprove(300)).toBe(false);
  });

  it('only the owner can request writes', () => {
    const auth = new AuthService(config);
    expect(auth.canRequestWrites(100)).toBe(true);
    expect(auth.canRequestWrites(200)).toBe(false);
    expect(auth.canRequestWrites(300)).toBe(false);
  });
});
