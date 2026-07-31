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

const commaSeparatedStrings = z
  .string()
  .default('')
  .transform((raw) => [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]);

const customEmojiIdsSchema = commaSeparatedStrings.refine(
  (values) => values.every((value) => /^\d{1,30}$/.test(value)),
  'must contain only comma-separated numeric custom emoji IDs',
);

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
  TELEGRAM_WEBHOOK_URL: z
    .string()
    .trim()
    .url('TELEGRAM_WEBHOOK_URL must be a valid URL')
    .refine((value) => value.startsWith('https://'), 'TELEGRAM_WEBHOOK_URL must use HTTPS')
    .refine((value) => {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /\/[A-Za-z0-9_-]{32,}$/.test(url.pathname)
      );
    }, 'must end in a secret path of at least 32 characters without credentials, query, or fragment'),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, 'must be 32-256 allowed characters'),
  TELEGRAM_WEBHOOK_CERTIFICATE_PATH: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  TELEGRAM_WEBHOOK_HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  TELEGRAM_WEBHOOK_PORT: integerFromEnvironment(8081, 1, 65_535),
  JYNX_OWNER_ID: telegramIdSchema,
  JYNX_ADMIN_IDS: adminIdsSchema,
  JYNX_APPROVAL_CHAT_ID: optionalTelegramIdSchema,
  JYNX_ERROR_CHAT_ID: optionalTelegramIdSchema,
  JYNX_CUSTOM_EMOJI_IDS: customEmojiIdsSchema,

  MAGICA_API_KEY: z.string().trim().min(1, 'MAGICA_API_KEY is required'),
  MAGICA_BASE_URL: z.string().trim().url('MAGICA_BASE_URL must be a valid URL'),
  MAGICA_MODEL: z.string().trim().min(1).default('claude_opus_4_8'),
  MAGICA_API_STYLE: z.enum(['openai', 'anthropic', 'custom']).default('openai'),

  GITHUB_TOKEN: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  GITHUB_REPO: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^[^/\s]+\/[^/\s]+$/, 'GITHUB_REPO must be in owner/name format')
      .optional(),
  ),
  GITHUB_DEFAULT_BRANCH: z.string().trim().min(1).default('main'),
  AGENT_WORKDIR: z.string().trim().min(1).default('.jynx-work'),

  JYNX_TIMEZONE: z.string().trim().min(1).default('UTC'),

  ENABLE_OWNER_INTROSPECTION: booleanFromEnvironment(true),
  INTROSPECTION_ROOT: z.string().trim().min(1).default('.'),

  WEB_SEARCH_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  WEB_SEARCH_BASE_URL: z
    .string()
    .trim()
    .url('WEB_SEARCH_BASE_URL must be a valid URL')
    .default('https://api.tavily.com'),
  WEB_SEARCH_MAX_RESULTS: integerFromEnvironment(5, 1, 20),

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
  MAX_CONCURRENT_AGENT_RUNS: integerFromEnvironment(1, 1, 10),
  MAX_CONCURRENT_MODEL_REQUESTS: integerFromEnvironment(4, 1, 50),
  MAX_MODEL_REQUESTS_PER_USER_PER_MINUTE: integerFromEnvironment(20, 1, 200),
  MAX_PROPOSALS_PER_USER_PER_HOUR: integerFromEnvironment(10, 1, 100),
  MESSAGE_BURST_COALESCE_MS: integerFromEnvironment(1200, 0, 10_000),
  ENABLE_MESSAGE_REACTIONS: booleanFromEnvironment(true),

  MODEL_TIMEOUT_MS: integerFromEnvironment(120_000, 1_000, 600_000),
  MODEL_MAX_RETRIES: integerFromEnvironment(2, 0, 10),

  DEFAULT_GROUP_PARTICIPATION: z
    .enum(['silent', 'mentioned_only', 'balanced', 'social', 'chaotic'])
    .default('balanced'),

  PROACTIVE_REPLY_COOLDOWN_SECONDS: integerFromEnvironment(180, 0, 86_400),
  PROACTIVE_REPLIES_PER_HOUR: integerFromEnvironment(4, 0, 100),

  ENABLE_SELF_MODIFICATION: booleanFromEnvironment(false),
  ENABLE_AUTOMATIC_RESTART: booleanFromEnvironment(false),

  AGENT_COMMAND_TIMEOUT_MS: integerFromEnvironment(300_000, 1_000, 3_600_000),
  AGENT_ALLOWED_COMMANDS: z
    .string()
    .trim()
    .default('git,npm')
    .transform((raw) => [
      ...new Set(
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]),
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

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
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
