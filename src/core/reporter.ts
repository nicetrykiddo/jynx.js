import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from './logger.js';

export interface ProposalMessage {
  chatId: number;
  messageId: number;
  link: string | null;
}

export function telegramMessageLink(chatId: number, messageId: number): string | null {
  const id = String(chatId);
  if (id.startsWith('-100')) {
    return `https://t.me/c/${id.slice(4)}/${messageId}`;
  }
  return null;
}

export function telegramHtml(text: string, maxLength = 3500): string {
  let source = text;
  for (;;) {
    const formatted = source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^\s*-\s+/gm, '• ')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    if (formatted.length <= maxLength) return formatted;
    const nextLength = Math.floor((source.length * maxLength) / formatted.length);
    source = source.slice(0, Math.min(source.length - 1, nextLength));
  }
}

export class Reporter {
  private readonly recentErrors = new Map<string, number>();

  public constructor(
    private readonly api: Api,
    private readonly config: Pick<AppConfig, 'JYNX_ERROR_CHAT_ID' | 'JYNX_APPROVAL_CHAT_ID'>,
    private readonly logger: Logger,
  ) {}

  public async reportError(context: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${context}:${message}`;
    const now = Date.now();
    const last = this.recentErrors.get(key) ?? 0;

    this.logger.error({ context, err: message }, 'jynx error');

    if (now - last < 60_000) {
      return;
    }
    this.recentErrors.set(key, now);

    if (!this.config.JYNX_ERROR_CHAT_ID) {
      return;
    }

    const text = `Jynx error\ncontext: ${context}\n${message.slice(0, 800)}`;
    try {
      await this.api.sendMessage(this.config.JYNX_ERROR_CHAT_ID, text);
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to send error report');
    }
  }

  public async requestApproval(summary: string, details: string): Promise<void> {
    if (!this.config.JYNX_APPROVAL_CHAT_ID) {
      this.logger.warn('approval requested but JYNX_APPROVAL_CHAT_ID is not configured');
      return;
    }

    const text = `Jynx approval request\n${summary}\n\n${details.slice(0, 3000)}`;
    try {
      await this.api.sendMessage(this.config.JYNX_APPROVAL_CHAT_ID, text);
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to send approval request');
    }
  }

  public async postProposal(
    text: string,
    approvalId?: number,
  ): Promise<ProposalMessage | undefined> {
    if (!this.config.JYNX_APPROVAL_CHAT_ID) {
      this.logger.warn('proposal posted but JYNX_APPROVAL_CHAT_ID is not configured');
      return;
    }
    const keyboard =
      approvalId === undefined
        ? undefined
        : new InlineKeyboard()
            .text('✅ Approve', `approve:${approvalId}`)
            .text('❌ Reject', `reject:${approvalId}`);
    try {
      const sent = await this.api.sendMessage(
        this.config.JYNX_APPROVAL_CHAT_ID,
        telegramHtml(text),
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        },
      );
      return {
        chatId: sent.chat.id,
        messageId: sent.message_id,
        link: telegramMessageLink(sent.chat.id, sent.message_id),
      };
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to post proposal');
    }
  }

  public async editProposal(
    chatId: number,
    messageId: number,
    text: string,
    approvalId?: number,
  ): Promise<boolean> {
    const keyboard =
      approvalId === undefined
        ? undefined
        : new InlineKeyboard()
            .text('✅ Approve', `approve:${approvalId}`)
            .text('❌ Reject', `reject:${approvalId}`);
    try {
      await this.api.editMessageText(chatId, messageId, telegramHtml(text), {
        parse_mode: 'HTML',
        reply_markup: keyboard ?? new InlineKeyboard(),
      });
      return true;
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to edit proposal');
      return false;
    }
  }

  public async notifySource(chatId: number, messageId: number, text: string): Promise<boolean> {
    try {
      await this.api.sendMessage(chatId, telegramHtml(text), {
        parse_mode: 'HTML',
        reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
      });
      return true;
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to notify proposal requester');
      return false;
    }
  }

  public async editSource(
    chatId: number,
    messageId: number,
    original: string,
    status: string,
  ): Promise<boolean> {
    try {
      await this.api.editMessageText(
        chatId,
        messageId,
        `${telegramHtml(original, 3000)}\n\n${telegramHtml(status, 900)}`,
        { parse_mode: 'HTML' },
      );
      return true;
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to edit source reply');
      return false;
    }
  }

  public async replaceSource(chatId: number, messageId: number, text: string): Promise<boolean> {
    try {
      await this.api.editMessageText(chatId, messageId, telegramHtml(text, 4000), {
        parse_mode: 'HTML',
      });
      return true;
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to replace source reply');
      return false;
    }
  }

  public async info(text: string): Promise<void> {
    if (!this.config.JYNX_ERROR_CHAT_ID) {
      return;
    }
    try {
      await this.api.sendMessage(this.config.JYNX_ERROR_CHAT_ID, text.slice(0, 3000));
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to send info report');
    }
  }
}
