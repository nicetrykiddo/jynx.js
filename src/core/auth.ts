import type { AppConfig } from '../config.js';

export type Role = 'owner' | 'admin' | 'user';

export interface Identity {
  userId: number;
  role: Role;
  isOwner: boolean;
  isAdmin: boolean;
}

export class AuthService {
  private readonly ownerId: number;
  private readonly adminIds: Set<number>;

  public constructor(config: Pick<AppConfig, 'JYNX_OWNER_ID' | 'JYNX_ADMIN_IDS'>) {
    this.ownerId = config.JYNX_OWNER_ID;
    this.adminIds = new Set(config.JYNX_ADMIN_IDS);
  }

  public identify(userId: number): Identity {
    const isOwner = userId === this.ownerId;
    const isAdmin = isOwner || this.adminIds.has(userId);
    const role: Role = isOwner ? 'owner' : isAdmin ? 'admin' : 'user';
    return { userId, role, isOwner, isAdmin };
  }

  public isOwner(userId: number): boolean {
    return userId === this.ownerId;
  }

  public isAdmin(userId: number): boolean {
    return this.isOwner(userId) || this.adminIds.has(userId);
  }

  public canApprove(userId: number): boolean {
    return this.isAdmin(userId);
  }
}
