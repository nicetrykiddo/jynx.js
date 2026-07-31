import { Bot, type Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import { AuthService, isTrustedOwnerChannel } from '../core/auth.js';
import { ConversationService } from '../core/conversation.js';
import { Reporter, telegramHtml } from '../core/reporter.js';
import { decideParticipation, type ParticipationMode } from '../core/participation.js';
import type { Repository } from '../storage/repository.js';
import { ProposalService } from '../agent/proposals.js';
import { ApprovalFlow } from '../agent/approval-flow.js';
import type { IntentDetector } from '../agent/intent.js';
import type { AgentRunner } from '../agent/runner.js';

export interface BotDependencies {
  config: AppConfig;
  logger: Logger;
  auth: AuthService;
  conversation: ConversationService;
  repository: Repository;
  intent: IntentDetector;
  agentRunner: AgentRunner;
}

function chatType(ctx: Context): 'private' | 'group' | 'supergroup' | 'channel' {
  const type = ctx.chat?.type ?? 'private';
  if (type === 'group' || type === 'supergroup' || type === 'channel') {
    return type;
  }
  return 'private';
}

function displayName(ctx: Context): string {
  const from = ctx.from;
  if (!from) {
    return 'unknown';
  }
  if (from.username) {
    return from.username;
  }
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.id);
}

function requesterLabel(ctx: Context): string {
  const from = ctx.from;
  if (!from) return 'unknown';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return from.username ? `${name || from.username} (@${from.username})` : name || String(from.id);
}

async function isMentioned(ctx: Context, botUsername: string): Promise<boolean> {
  const text = ctx.message?.text ?? ctx.message?.caption ?? '';
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  if (lower.includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }
  return /\bjynx\b/i.test(text);
}

export function parseNaturalEdit(text: string): string | null {
  const match = text.match(/^edit(?: this| that| your(?: last)? message)?(?: to|:)\s+([\s\S]+)$/i);
  return match?.[1]?.trim() || null;
}

export function serializeTelegramContext(value: unknown): string {
  const blocked = new Set(['invite_link', 'file_id', 'file_unique_id']);
  const raw = JSON.stringify(value, (key, item) => (blocked.has(key) ? undefined : item)) ?? 'null';
  return raw.length > 12_000 ? `${raw.slice(0, 12_000)}…` : raw;
}

export function allowWithinWindow(
  entries: Map<number, number[]>,
  key: number,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  if (!entries.has(key) && entries.size >= 10_000) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const recent = (entries.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length >= limit) {
    entries.set(key, recent);
    return false;
  }
  recent.push(now);
  entries.set(key, recent);
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function customEmojiReply(
  text: string,
  customEmojiIds: string[],
  seed: number,
  favored: boolean,
): string {
  if (customEmojiIds.length === 0 || seed % (favored ? 3 : 5) !== 0) return text;
  const customEmojiId = customEmojiIds[Math.abs(seed) % customEmojiIds.length];
  return `${text} <tg-emoji emoji-id="${customEmojiId}">❤️</tg-emoji>`;
}

export function createBot(deps: BotDependencies): Bot {
  const { config, logger, auth, conversation, repository, intent, agentRunner } = deps;
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const reporter = new Reporter(bot.api, config, logger);
  const proposals = new ProposalService({
    repository,
    reporter,
    intent,
    runner: agentRunner,
    logger,
    config,
  });
  const approvalFlow = new ApprovalFlow({
    config,
    auth,
    repository,
    reporter,
    runner: agentRunner,
    logger,
  });
  const lastReplyAt = new Map<number, number>();
  const telegramContextCache = new Map<string, { expiresAt: number; value: string }>();
  const modelRequests = new Map<number, number[]>();
  const burstVersions = new Map<number, number>();

  const reactNaturally = async (ctx: Context): Promise<void> => {
    if (!config.ENABLE_MESSAGE_REACTIONS || !ctx.chat || !ctx.message) return;
    const customEmojiId =
      config.JYNX_CUSTOM_EMOJI_IDS[
        Math.abs(ctx.message.message_id) % Math.max(1, config.JYNX_CUSTOM_EMOJI_IDS.length)
      ];
    if (customEmojiId) {
      try {
        await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [
          { type: 'custom_emoji', custom_emoji_id: customEmojiId },
        ]);
        return;
      } catch {
        // Custom reactions must also be allowed by the chat; fall back to a normal reaction.
      }
    }
    const emoji = ctx.message.message_id % 3 === 0 ? '❤' : '👍';
    await ctx.api
      .setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: 'emoji', emoji }])
      .catch(() => undefined);
  };

  const telegramContext = async (ctx: Context): Promise<string> => {
    if (!ctx.from || !ctx.chat) return '';
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    const cached = telegramContextCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const [userProfile, userGifts, chatProfile, chatGifts, membership, memberCount] =
      await Promise.allSettled([
        ctx.api.getChat(ctx.from.id),
        ctx.api.getUserGifts(ctx.from.id, { limit: 20 }),
        ctx.api.getChat(ctx.chat.id),
        ctx.api.getChatGifts(ctx.chat.id, { limit: 20 }),
        isGroup ? ctx.api.getChatMember(ctx.chat.id, ctx.from.id) : Promise.resolve(undefined),
        isGroup ? ctx.api.getChatMemberCount(ctx.chat.id) : Promise.resolve(undefined),
      ]);
    const valueOf = <T>(result: PromiseSettledResult<T>): T | undefined =>
      result.status === 'fulfilled' ? result.value : undefined;
    const value = serializeTelegramContext({
      user: ctx.from,
      userProfile: valueOf(userProfile),
      userGifts: valueOf(userGifts),
      chat: ctx.chat,
      chatProfile: valueOf(chatProfile),
      chatGifts: valueOf(chatGifts),
      membership: valueOf(membership),
      memberCount: valueOf(memberCount),
    });
    if (telegramContextCache.size >= 1000) {
      const oldest = telegramContextCache.keys().next().value;
      if (oldest) telegramContextCache.delete(oldest);
    }
    telegramContextCache.set(key, { expiresAt: Date.now() + 10 * 60_000, value });
    return value;
  };

  bot.catch((error) => {
    void reporter.reportError('bot.middleware', error.error);
  });

  bot.command('start', async (ctx) => {
    await ctx.reply("hey, i'm Jynx. talk to me normally, or add me to a group.");
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Just talk to me. In groups I reply when mentioned or when I actually have something worth saying.',
    );
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command(['whoami', 'id'], async (ctx) => {
    if (!ctx.from) {
      return;
    }
    const identity = auth.identify(ctx.from.id);
    await ctx.reply(`id: ${identity.userId}\nrole: ${identity.role}`);
  });

  bot.command('edit', async (ctx) => {
    if (!ctx.from || !ctx.chat || !auth.isOwner(ctx.from.id)) {
      await ctx.reply('only the owner can edit my messages.');
      return;
    }
    const raw = (ctx.match ?? '').toString().trim();
    const replied = ctx.message?.reply_to_message;
    let messageId = replied?.from?.id === ctx.me.id ? replied.message_id : null;
    let content = raw;
    if (messageId === null) {
      const match = raw.match(/^(\d+)\s+([\s\S]+)$/);
      messageId = match?.[1] ? Number(match[1]) : null;
      content = match?.[2]?.trim() ?? '';
    }
    if (!messageId || !content || content.length > 4096) {
      await ctx.reply(
        'reply to one of my messages with /edit <new text>, or use /edit <message id> <new text>.',
      );
      return;
    }
    try {
      await ctx.api.editMessageText(ctx.chat.id, messageId, content);
      try {
        await repository.updateAssistantMessageContent(ctx.chat.id, messageId, content);
      } catch (error) {
        await reporter.reportError('persist.message.edit', error);
      }
    } catch (error) {
      await reporter.reportError('message.edit', error);
      await ctx.reply("couldn't edit that message.");
    }
  });

  const parseApprovalId = (raw: string): number | null => {
    const value = Number(raw.trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  bot.command('approve', async (ctx) => {
    if (!ctx.from) {
      return;
    }
    if (!auth.isOwner(ctx.from.id)) {
      await ctx.reply('only the owner can approve.');
      return;
    }
    const id = parseApprovalId((ctx.match ?? '').toString());
    if (id === null) {
      await ctx.reply('usage: /approve <id>');
      return;
    }
    try {
      const result = await approvalFlow.approve(ctx.from.id, id);
      await ctx.reply(result.reply);
    } catch (error) {
      await reporter.reportError('approve', error);
    }
  });

  bot.command('reject', async (ctx) => {
    if (!ctx.from) {
      return;
    }
    if (!auth.isOwner(ctx.from.id)) {
      await ctx.reply('only the owner can reject.');
      return;
    }
    const id = parseApprovalId((ctx.match ?? '').toString());
    if (id === null) {
      await ctx.reply('usage: /reject <id>');
      return;
    }
    try {
      const result = await approvalFlow.reject(ctx.from.id, id);
      await ctx.reply(result.reply);
    } catch (error) {
      await reporter.reportError('reject', error);
    }
  });

  bot.callbackQuery(/^(approve|reject):(\d+)$/, async (ctx) => {
    const from = ctx.from;
    if (!from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!auth.isOwner(from.id)) {
      await ctx.answerCallbackQuery({ text: 'only the owner can decide.', show_alert: true });
      return;
    }
    const action = ctx.match[1];
    const id = Number(ctx.match[2]);
    try {
      const result =
        action === 'approve'
          ? await approvalFlow.approve(from.id, id)
          : await approvalFlow.reject(from.id, id);
      await ctx.answerCallbackQuery({ text: result.reply.slice(0, 200) });
    } catch (error) {
      await ctx.answerCallbackQuery({ text: 'something broke, check logs.', show_alert: true });
      await reporter.reportError(`callback.${action}`, error);
    }
  });

  bot.command('mode', async (ctx) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }
    if (!auth.isAdmin(ctx.from.id)) {
      await ctx.reply('only admins can change my participation mode.');
      return;
    }
    const arg = (ctx.match ?? '').toString().trim();
    const valid: ParticipationMode[] = [
      'silent',
      'mentioned_only',
      'balanced',
      'social',
      'chaotic',
    ];
    if (!valid.includes(arg as ParticipationMode)) {
      await ctx.reply(`usage: /mode <${valid.join('|')}>`);
      return;
    }
    await repository.setChatParticipation(ctx.chat.id, arg);
    await ctx.reply(`participation mode set to ${arg}.`);
  });

  bot.on('message:text', async (ctx) => {
    if (!ctx.from || !ctx.chat || !ctx.message) {
      return;
    }

    const text = ctx.message.text;
    if (text.startsWith('/')) {
      return;
    }

    const type = chatType(ctx);
    const isPrivate = type === 'private';
    const isGroup = type === 'group' || type === 'supergroup';
    const identity = auth.identify(ctx.from.id);
    const isTrustedChat = isTrustedOwnerChannel(
      identity,
      { id: ctx.chat.id, type },
      { approval: config.JYNX_APPROVAL_CHAT_ID, error: config.JYNX_ERROR_CHAT_ID },
    );
    const name = displayName(ctx);

    if (identity.isOwner && ctx.message.reply_to_message?.from?.id === ctx.me.id) {
      const edited = parseNaturalEdit(text);
      if (edited) {
        try {
          const messageId = ctx.message.reply_to_message.message_id;
          const content = edited.slice(0, 4096);
          await ctx.api.editMessageText(ctx.chat.id, messageId, content);
          try {
            await repository.updateAssistantMessageContent(ctx.chat.id, messageId, content);
          } catch (error) {
            await reporter.reportError('persist.message.edit', error);
          }
        } catch (error) {
          await reporter.reportError('message.edit', error);
        }
        return;
      }
    }

    try {
      await repository.upsertChat({
        id: ctx.chat.id,
        type,
        title: 'title' in ctx.chat ? (ctx.chat.title ?? null) : null,
      });
      await repository.upsertUser({
        id: ctx.from.id,
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
        isOwner: identity.isOwner,
        isAdmin: identity.isAdmin,
      });
    } catch (error) {
      await reporter.reportError('persist.user', error);
    }

    const botUsername = ctx.me.username;
    const mentioned = await isMentioned(ctx, botUsername);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

    let mode: ParticipationMode = config.DEFAULT_GROUP_PARTICIPATION;
    if (isGroup) {
      try {
        const chat = await repository.getChat(ctx.chat.id);
        if (chat?.participation) {
          mode = chat.participation as ParticipationMode;
        }
      } catch (error) {
        await reporter.reportError('load.participation', error);
      }
    }

    const now = Date.now();
    const lastAt = lastReplyAt.get(ctx.chat.id) ?? 0;
    const secondsSinceLastReply = (now - lastAt) / 1000;
    let recentAssistantCount = 0;
    let hourlyAssistantCount = 0;
    if (isGroup) {
      try {
        [recentAssistantCount, hourlyAssistantCount] = await Promise.all([
          repository.countRecentAssistantMessages(
            ctx.chat.id,
            config.PROACTIVE_REPLY_COOLDOWN_SECONDS * 1000,
          ),
          repository.countRecentAssistantMessages(ctx.chat.id, 60 * 60 * 1000),
        ]);
      } catch (error) {
        await reporter.reportError('count.assistant', error);
      }
    }

    const recentlyEngaged =
      lastAt > 0 && secondsSinceLastReply <= config.PROACTIVE_REPLY_COOLDOWN_SECONDS * 2;
    const mentionsBotByName = /\bjynx\b/i.test(text);

    const decision = decideParticipation({
      mode,
      isPrivate,
      isMentioned: mentioned,
      isReplyToBot,
      recentAssistantCount,
      hourlyAssistantCount,
      proactiveRepliesPerHour: config.PROACTIVE_REPLIES_PER_HOUR,
      secondsSinceLastReply,
      recentlyEngaged,
      mentionsBotByName,
    });

    if (!decision.shouldConsiderReply) {
      try {
        await repository.addMessage({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          telegramMessageId: ctx.message.message_id,
          replyToMessageId: ctx.message.reply_to_message?.message_id ?? null,
          role: 'user',
          content: text,
          metadata: { displayName: name },
        });
      } catch (error) {
        await reporter.reportError('persist.message.silent', error);
      }
      return;
    }

    if (
      !allowWithinWindow(
        modelRequests,
        ctx.from.id,
        config.MAX_MODEL_REQUESTS_PER_USER_PER_MINUTE,
        60_000,
      )
    ) {
      await ctx.reply('slow down a sec, you’re sending more than i can answer cleanly');
      return;
    }

    const burstVersion = (burstVersions.get(ctx.chat.id) ?? 0) + 1;
    if (!burstVersions.has(ctx.chat.id) && burstVersions.size >= 10_000) {
      const oldest = burstVersions.keys().next().value;
      if (oldest !== undefined) burstVersions.delete(oldest);
    }
    burstVersions.set(ctx.chat.id, burstVersion);
    if (config.MESSAGE_BURST_COALESCE_MS > 0) {
      await delay(config.MESSAGE_BURST_COALESCE_MS);
    }
    if (burstVersions.get(ctx.chat.id) !== burstVersion) {
      try {
        await repository.addMessage({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          telegramMessageId: ctx.message.message_id,
          replyToMessageId: ctx.message.reply_to_message?.message_id ?? null,
          role: 'user',
          content: text,
          metadata: { displayName: name },
        });
        if (ctx.message.message_id % 3 !== 1) await reactNaturally(ctx);
      } catch (error) {
        await reporter.reportError('persist.message.coalesced', error);
      }
      return;
    }

    try {
      await ctx.replyWithChatAction('typing');
      const result = await conversation.respond({
        identity,
        chatId: ctx.chat.id,
        chatType: type,
        userText: text,
        displayName: name,
        trustedIntrospection: isTrustedChat,
        telegramContext: await telegramContext(ctx),
      });

      try {
        await repository.addMessage({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          telegramMessageId: ctx.message.message_id,
          replyToMessageId: ctx.message.reply_to_message?.message_id ?? null,
          role: 'user',
          content: text,
          metadata: { displayName: name },
        });
      } catch (error) {
        await reporter.reportError('persist.message.user', error);
      }

      let reply = result.reply;
      let proposalRef: { approvalId: number; link: string | null } | null = null;
      try {
        proposalRef = await proposals.considerMessage({
          userId: ctx.from.id,
          requestedByName: requesterLabel(ctx),
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          text,
          requesterRole: identity.role,
          trustedChannel: isTrustedChat,
          assistantReply: reply,
        });
        if (proposalRef?.link) {
          const footer = `Approval #${proposalRef.approvalId}: ${proposalRef.link}`;
          reply = `${reply.slice(0, 4095 - footer.length)}\n${footer}`;
        }
      } catch (error) {
        await reporter.reportError('proposals.consider', error);
      }

      const formatted = telegramHtml(reply, 4000);
      const decorated = customEmojiReply(
        formatted,
        config.JYNX_CUSTOM_EMOJI_IDS,
        ctx.message.message_id,
        identity.role === 'owner',
      );
      const replyOptions = {
        reply_parameters: isGroup ? { message_id: ctx.message.message_id } : undefined,
        parse_mode: 'HTML' as const,
      };
      let sent;
      try {
        sent = await ctx.reply(decorated, replyOptions);
      } catch (error) {
        if (decorated === formatted) throw error;
        sent = await ctx.reply(formatted, replyOptions);
      }

      lastReplyAt.set(ctx.chat.id, Date.now());

      if (proposalRef) {
        try {
          await repository.setApprovalSourceReply(proposalRef.approvalId, sent.message_id, reply);
        } catch (error) {
          await reporter.reportError('persist.approval.source-reply', error);
        }
      }

      await repository.addMessage({
        chatId: ctx.chat.id,
        userId: ctx.me.id,
        telegramMessageId: sent.message_id,
        replyToMessageId: ctx.message.message_id,
        role: 'assistant',
        content: reply,
        metadata: { displayName: 'Jynx' },
      });
    } catch (error) {
      await reporter.reportError('conversation.respond', error);
    }
  });

  return bot;
}
