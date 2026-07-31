import { describe, expect, it } from 'vitest';
import { AuthService, isTrustedOwnerChannel } from '../src/core/auth.js';

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

  it('trusts only owner DMs and the configured approval and error groups', () => {
    const auth = new AuthService(config);
    const owner = auth.identify(100);
    const user = auth.identify(300);
    const channels = { approval: -1001, error: -1002 };

    expect(isTrustedOwnerChannel(owner, { id: 100, type: 'private' }, channels)).toBe(true);
    expect(isTrustedOwnerChannel(owner, { id: -1001, type: 'supergroup' }, channels)).toBe(true);
    expect(isTrustedOwnerChannel(owner, { id: -1002, type: 'supergroup' }, channels)).toBe(true);
    expect(isTrustedOwnerChannel(owner, { id: -1003, type: 'supergroup' }, channels)).toBe(false);
    expect(isTrustedOwnerChannel(user, { id: -1001, type: 'supergroup' }, channels)).toBe(false);
  });
});
