import { Bot, type Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import { AuthService } from '../core/auth.js';
import { ConversationService } from '../core/conversation.js';
import { Reporter } from '../core/reporter.js';
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

export function createBot(deps: BotDependencies): Bot {
  const { config, logger, auth, conversation, repository, intent, agentRunner } = deps;
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const reporter = new Reporter(bot.api, config, logger);
  const proposals = new ProposalService({ repository, reporter, intent, runner: agentRunner, logger });
  const approvalFlow = new ApprovalFlow({ config, auth, repository, reporter, runner: agentRunner, logger });
  const lastReplyAt = new Map<number, number>();

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

  bot.command('whoami', async (ctx) => {
    if (!ctx.from) {
      return;
    }
    const identity = auth.identify(ctx.from.id);
    await ctx.reply(`id: ${identity.userId}\nrole: ${identity.role}`);
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
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // markup may already be gone; ignore
      }
      await ctx.reply(result.reply);
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
    const valid: ParticipationMode[] = ['silent', 'mentioned_only', 'balanced', 'social', 'chaotic'];
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
    const name = displayName(ctx);

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
      await reporter.reportError('persist.message', error);
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
    if (isGroup) {
      try {
        recentAssistantCount = await repository.countRecentAssistantMessages(
          ctx.chat.id,
          config.PROACTIVE_REPLY_COOLDOWN_SECONDS * 1000,
        );
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
      secondsSinceLastReply,
      recentlyEngaged,
      mentionsBotByName,
    });

    if (!decision.shouldConsiderReply) {
      return;
    }

    try {
      await ctx.replyWithChatAction('typing');
      const isTrustedChat =
        (isPrivate && identity.isOwner) ||
        ctx.chat.id === config.JYNX_APPROVAL_CHAT_ID ||
        ctx.chat.id === config.JYNX_ERROR_CHAT_ID;
      const result = await conversation.respond({
        identity,
        chatId: ctx.chat.id,
        chatType: type,
        userText: text,
        displayName: name,
        trustedIntrospection: isTrustedChat,
      });

      const sent = await ctx.reply(result.reply, {
        reply_parameters: isGroup ? { message_id: ctx.message.message_id } : undefined,
      });

      lastReplyAt.set(ctx.chat.id, Date.now());

      await repository.addMessage({
        chatId: ctx.chat.id,
        userId: ctx.me.id,
        telegramMessageId: sent.message_id,
        replyToMessageId: ctx.message.message_id,
        role: 'assistant',
        content: result.reply,
        metadata: { displayName: 'Jynx' },
      });
    } catch (error) {
      await reporter.reportError('conversation.respond', error);
    }

    if (identity.isOwner) {
      try {
        await proposals.considerMessage({ userId: ctx.from.id, text });
      } catch (error) {
        await reporter.reportError('proposals.consider', error);
      }
    }
  });

  return bot;
}
