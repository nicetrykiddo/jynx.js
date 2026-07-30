import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import {
  approvals,
  chats,
  memories,
  messages,
  tasks,
  users,
  type Approval,
  type Chat,
  type Message,
  type NewMessage,
  type Task,
} from './schema.js';

export interface UpsertChatInput {
  id: number;
  type: string;
  title?: string | null;
}

export interface UpsertUserInput {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isOwner?: boolean;
  isAdmin?: boolean;
}

export class Repository {
  public constructor(private readonly db: Database) {}

  public async upsertChat(input: UpsertChatInput): Promise<void> {
    await this.db
      .insert(chats)
      .values({ id: input.id, type: input.type, title: input.title ?? null })
      .onConflictDoUpdate({
        target: chats.id,
        set: { type: input.type, title: input.title ?? null, updatedAt: new Date() },
      });
  }

  public async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.db
      .insert(users)
      .values({
        id: input.id,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        isOwner: input.isOwner ?? false,
        isAdmin: input.isAdmin ?? false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          username: input.username ?? null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          updatedAt: new Date(),
        },
      });
  }

  public async getChat(chatId: number): Promise<Chat | undefined> {
    const rows = await this.db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    return rows[0];
  }

  public async setChatParticipation(chatId: number, participation: string): Promise<void> {
    await this.db
      .update(chats)
      .set({ participation, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  public async addMessage(input: NewMessage): Promise<Message> {
    const [row] = await this.db.insert(messages).values(input).returning();
    return row as Message;
  }

  public async getRecentMessages(chatId: number, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  public async searchMessages(
    chatId: number,
    query: string,
    limit = 20,
  ): Promise<Message[]> {
    const pattern = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), sql`${messages.content} ilike ${pattern}`))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  public async getMessagesInRange(
    chatId: number,
    limit: number,
    beforeId?: number,
  ): Promise<Message[]> {
    const conditions = [eq(messages.chatId, chatId)];
    if (beforeId !== undefined) {
      conditions.push(sql`${messages.id} < ${beforeId}`);
    }
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  public async countRecentAssistantMessages(
    chatId: number,
    sinceMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - sinceMs);
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.role, 'assistant'),
          sql`${messages.createdAt} >= ${since}`,
        ),
      );
    return rows[0]?.count ?? 0;
  }

  public async addMemory(input: {
    chatId?: number | null;
    userId?: number | null;
    kind: string;
    content: string;
    importance?: number;
  }): Promise<void> {
    await this.db.insert(memories).values({
      chatId: input.chatId ?? null,
      userId: input.userId ?? null,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 1,
    });
  }

  public async getMemories(chatId: number | null, userId: number | null): Promise<string[]> {
    const conditions = [];
    if (chatId !== null) conditions.push(eq(memories.chatId, chatId));
    if (userId !== null) conditions.push(eq(memories.userId, userId));
    const rows = await this.db
      .select()
      .from(memories)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memories.importance), desc(memories.createdAt))
      .limit(20);
    return rows.map((row) => row.content);
  }

  public async createTask(input: {
    chatId?: number | null;
    userId?: number | null;
    title: string;
    description?: string | null;
    state?: unknown;
    steps?: unknown;
  }): Promise<Task> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        chatId: input.chatId ?? null,
        userId: input.userId ?? null,
        title: input.title,
        description: input.description ?? null,
        state: input.state ?? null,
        steps: input.steps ?? null,
      })
      .returning();
    return row as Task;
  }

  public async updateTask(
    id: number,
    patch: Partial<{
      status: string;
      state: unknown;
      steps: unknown;
      lastError: string | null;
    }>,
  ): Promise<void> {
    await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  public async getActiveTasks(): Promise<Task[]> {
    return this.db
      .select()
      .from(tasks)
      .where(sql`${tasks.status} in ('pending', 'running')`)
      .orderBy(desc(tasks.updatedAt));
  }

  public async countActiveRunsForUser(userId: number): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), sql`${tasks.status} in ('pending', 'running')`));
    return rows[0]?.count ?? 0;
  }

  public async createApproval(input: {
    requestedBy?: number | null;
    kind: string;
    stage?: string;
    summary: string;
    payload?: unknown;
    taskId?: number | null;
  }): Promise<Approval> {
    const [row] = await this.db
      .insert(approvals)
      .values({
        requestedBy: input.requestedBy ?? null,
        kind: input.kind,
        stage: input.stage ?? 'idea',
        summary: input.summary,
        payload: input.payload ?? null,
        taskId: input.taskId ?? null,
      })
      .returning();
    return row as Approval;
  }

  public async listPendingApprovals(): Promise<Approval[]> {
    return this.db
      .select()
      .from(approvals)
      .where(eq(approvals.status, 'pending'))
      .orderBy(desc(approvals.createdAt));
  }

  public async getApproval(id: number): Promise<Approval | undefined> {
    const rows = await this.db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    return rows[0];
  }

  public async decideApproval(
    id: number,
    status: 'approved' | 'rejected',
    decidedBy: number,
  ): Promise<Approval | undefined> {
    const [row] = await this.db
      .update(approvals)
      .set({ status, decidedBy, decidedAt: new Date() })
      .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
      .returning();
    return row;
  }

  public async advanceApprovalStage(id: number, stage: string, taskId?: number | null): Promise<void> {
    await this.db
      .update(approvals)
      .set({ stage, taskId: taskId ?? null })
      .where(eq(approvals.id, id));
  }
}
