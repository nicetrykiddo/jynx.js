import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const chats = pgTable('chats', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  title: text('title'),
  participation: text('participation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  isOwner: boolean('is_owner').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    replyToMessageId: bigint('reply_to_message_id', { mode: 'number' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatCreatedIdx: index('messages_chat_created_idx').on(table.chatId, table.createdAt),
  }),
);

export const memories = pgTable(
  'memories',
  {
    id: serial('id').primaryKey(),
    chatId: bigint('chat_id', { mode: 'number' }),
    userId: bigint('user_id', { mode: 'number' }),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    importance: integer('importance').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeIdx: index('memories_scope_idx').on(table.chatId, table.userId),
  }),
);

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    chatId: bigint('chat_id', { mode: 'number' }),
    userId: bigint('user_id', { mode: 'number' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('pending'),
    state: jsonb('state'),
    steps: jsonb('steps'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('tasks_status_idx').on(table.status),
  }),
);

export const approvals = pgTable(
  'approvals',
  {
    id: serial('id').primaryKey(),
    requestedBy: bigint('requested_by', { mode: 'number' }),
    kind: text('kind').notNull(),
    stage: text('stage').notNull().default('idea'),
    summary: text('summary').notNull(),
    payload: jsonb('payload'),
    taskId: integer('task_id'),
    status: text('status').notNull().default('pending'),
    decidedBy: bigint('decided_by', { mode: 'number' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('approvals_status_idx').on(table.status),
  }),
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
