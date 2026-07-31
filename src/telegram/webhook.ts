import { createServer } from 'node:http';
import { Bot, InputFile, webhookCallback } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';

type WebhookConfig = Pick<
  AppConfig,
  | 'TELEGRAM_WEBHOOK_URL'
  | 'TELEGRAM_WEBHOOK_SECRET'
  | 'TELEGRAM_WEBHOOK_CERTIFICATE_PATH'
  | 'TELEGRAM_WEBHOOK_HOST'
  | 'TELEGRAM_WEBHOOK_PORT'
>;

export function isWebhookRequest(
  method: string | undefined,
  url: string | undefined,
  path: string,
) {
  return method === 'POST' && new URL(url ?? '/', 'http://localhost').pathname === path;
}

export async function startWebhook(bot: Bot, config: WebhookConfig, logger: Logger) {
  const path = new URL(config.TELEGRAM_WEBHOOK_URL).pathname;
  const handleUpdate = webhookCallback(bot, 'http', {
    secretToken: config.TELEGRAM_WEBHOOK_SECRET,
    timeoutMilliseconds: 5_000,
    onTimeout: 'return',
  });
  const server = createServer((request, response) => {
    if (!isWebhookRequest(request.method, request.url, path)) {
      response.writeHead(404).end();
      return;
    }
    void handleUpdate(request, response).catch((error) => {
      logger.error({ err: error }, 'webhook request failed');
      if (!response.headersSent) response.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.TELEGRAM_WEBHOOK_PORT, config.TELEGRAM_WEBHOOK_HOST, resolve);
  });

  try {
    await bot.api.setWebhook(config.TELEGRAM_WEBHOOK_URL, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      certificate: config.TELEGRAM_WEBHOOK_CERTIFICATE_PATH
        ? new InputFile(config.TELEGRAM_WEBHOOK_CERTIFICATE_PATH)
        : undefined,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 10,
    });
  } catch (error) {
    server.close();
    throw error;
  }

  logger.info(
    { host: config.TELEGRAM_WEBHOOK_HOST, port: config.TELEGRAM_WEBHOOK_PORT },
    'telegram webhook ready',
  );
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
