import type { Api } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from './logger.js';

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

  public async postProposal(text: string): Promise<void> {
    if (!this.config.JYNX_APPROVAL_CHAT_ID) {
      this.logger.warn('proposal posted but JYNX_APPROVAL_CHAT_ID is not configured');
      return;
    }
    try {
      await this.api.sendMessage(this.config.JYNX_APPROVAL_CHAT_ID, text.slice(0, 3500));
    } catch (sendError) {
      this.logger.error({ err: sendError }, 'failed to post proposal');
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
