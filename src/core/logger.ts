import pino from 'pino';
import type { AppConfig } from '../config.js';

const SECRET_KEYS = [
  'token',
  'apikey',
  'api_key',
  'password',
  'authorization',
  'secret',
  'databaseurl',
  'database_url',
];

function redactValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 0) {
    return '[redacted]';
  }
  return value;
}

export function redactSecrets<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item)) as unknown as T;
  }

  if (input && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
      if (SECRET_KEYS.some((secret) => normalized.includes(secret.replace(/[^a-z]/g, '')))) {
        result[key] = redactValue(value);
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result as T;
  }

  return input;
}

export type Logger = pino.Logger;

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const isDevelopment = config.NODE_ENV === 'development';

  return pino({
    level: config.LOG_LEVEL,
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}
