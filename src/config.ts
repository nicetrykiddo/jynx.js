import 'dotenv/config';
import { z } from 'zod';

const telegramIdSchema = z
  .string()
  .trim()
  .regex(/^-?\d+$/, 'must be a numeric Telegram ID')
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, 'Telegram ID is outside JavaScript safe integer range');

const optionalTelegramIdSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}, telegramIdSchema.optional());

const adminIdsSchema = z
  .string()
  .default('')
  .transform((raw, context): number[] => {
    const values = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const ids: number[] = [];

    for (const value of values) {
      if (!/^-?\d+$/.test(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `contains a non-numeric Telegram ID: ${value}`,
        });

        return z.NEVER;
      }

      const id = Number(value);

      if (!Number.isSafeInteger(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `contains an unsafe Telegram ID: ${value}`,
        });

        return z.NEVER;
      }

      ids.push(id);
    }

    return [...new Set(ids)];
  });

const booleanFromEnvironment = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }

    return value;
  }, z.boolean());

const integerFromEnvironment = (defaultValue: number, minimum: number, maximum?: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }

      if (typeof value === 'number') {
        return value;
      }

      if (typeof value === 'string') {
        return Number(value.trim());
      }

      return value;
    },
    maximum === undefined
      ? z.number().int().min(minimum)
      : z.number().int().min(minimum).max(maximum),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  JYNX_OWNER_ID: telegramIdSchema,
  JYNX_ADMIN_IDS: adminIdsSchema,
  JYNX_APPROVAL_CHAT_ID: optionalTelegramIdSchema,
  JYNX_ERROR_CHAT_ID: optionalTelegramIdSchema,

  MAGICA_API_KEY: z.string().trim().min(1, 'MAGICA_API_KEY is required'),
  MAGICA_BASE_URL: z.string().trim().url('MAGICA_BASE_URL must be a valid URL'),
  MAGICA_MODEL: z.string().trim().min(1).default('claude_opus_4_8'),
  MAGICA_API_STYLE: z.enum(['openai', 'anthropic', 'custom']).default('openai'),

  DATABASE_URL: z
    .string()
    .trim()
    .url('DATABASE_URL must be a valid PostgreSQL URL')
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use postgresql:// or postgres://',
    ),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRIVATE_MESSAGES: booleanFromEnvironment(false),
  LOG_MODEL_PROMPTS: booleanFromEnvironment(false),
  LOG_TOOL_OUTPUTS: booleanFromEnvironment(false),

  MAX_HISTORY_MESSAGES: integerFromEnvironment(40, 1, 500),
  MAX_GROUP_CONTEXT_MESSAGES: integerFromEnvironment(80, 1, 1_000),
  MAX_RESPONSE_CHARS: integerFromEnvironment(12_000, 500, 100_000),

  MAX_AGENT_STEPS: integerFromEnvironment(15, 1, 100),
  MAX_ACTIVE_RUNS_PER_USER: integerFromEnvironment(2, 1, 20),

  MODEL_TIMEOUT_MS: integerFromEnvironment(120_000, 1_000, 600_000),
  MODEL_MAX_RETRIES: integerFromEnvironment(2, 0, 10),

  DEFAULT_GROUP_PARTICIPATION: z
    .enum(['silent', 'mentioned_only', 'balanced', 'social', 'chaotic'])
    .default('balanced'),

  PROACTIVE_REPLY_COOLDOWN_SECONDS: integerFromEnvironment(180, 0, 86_400),
  PROACTIVE_REPLIES_PER_HOUR: integerFromEnvironment(4, 0, 100),

  ENABLE_SELF_MODIFICATION: booleanFromEnvironment(false),
  ENABLE_AUTOMATIC_RESTART: booleanFromEnvironment(false),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigurationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Invalid Jynx configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export function loadConfig(environment: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `${path}: ${issue.message}`;
    });

    throw new ConfigurationError(issues);
  }

  return {
    ...result.data,
    JYNX_ADMIN_IDS: [...new Set([result.data.JYNX_OWNER_ID, ...result.data.JYNX_ADMIN_IDS])],
  };
}

export { envSchema };
