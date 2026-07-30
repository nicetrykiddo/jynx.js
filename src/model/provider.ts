import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ModelProvider,
} from './types.js';

interface RunResponse {
  runId?: string;
  id?: string;
}

interface PollResponse {
  status?: string;
  output?:
    | {
        output?: string;
        [key: string]: unknown;
      }
    | null;
  error?: unknown;
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'SUCCEEDED', 'FAILED', 'ERROR', 'CANCELLED']);
const FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'CANCELLED']);

function splitMessages(messages: ChatMessage[]): { systemPrompt: string; prompt: string } {
  const systemParts: string[] = [];
  const conversation: string[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === 'assistant') {
      conversation.push(`Jynx: ${message.content}`);
      continue;
    }
    if (message.role === 'tool') {
      conversation.push(`Tool (${message.name ?? 'result'}): ${message.content}`);
      continue;
    }
    conversation.push(message.content);
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    prompt: conversation.join('\n'),
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class MagicaProvider implements ModelProvider {
  public readonly name = 'magica';

  public constructor(
    private readonly config: Pick<
      AppConfig,
      'MAGICA_API_KEY' | 'MAGICA_BASE_URL' | 'MAGICA_MODEL' | 'MODEL_TIMEOUT_MS' | 'MODEL_MAX_RETRIES'
    >,
    private readonly logger: Logger,
  ) {}

  public async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { systemPrompt, prompt } = splitMessages(request.messages);
    const input: Record<string, unknown> = {
      prompt: prompt.length > 0 ? prompt : '(no message)',
      temperature: request.temperature ?? 0.8,
    };

    if (systemPrompt.length > 0) {
      input.system_prompt = systemPrompt;
    }

    if (request.maxTokens) {
      input.max_tokens = request.maxTokens;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.MODEL_MAX_RETRIES; attempt += 1) {
      try {
        return await this.runAndPoll(input);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          { attempt, err: error instanceof Error ? error.message : String(error) },
          'model request failed',
        );
        if (attempt < this.config.MODEL_MAX_RETRIES) {
          await delay(500 * (attempt + 1));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('model request failed');
  }

  private get baseUrl(): string {
    return this.config.MAGICA_BASE_URL.replace(/\/$/, '');
  }

  private async startRun(input: Record<string, unknown>): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/nodes/${this.config.MAGICA_MODEL}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.MAGICA_API_KEY}`,
        },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`model run responded ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = (await response.json()) as RunResponse;
      const runId = data.runId ?? data.id;
      if (!runId) {
        throw new Error('model run did not return a runId');
      }
      return runId;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async pollRun(runId: string): Promise<CompletionResult> {
    const deadline = Date.now() + this.config.MODEL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await delay(2000);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let data: PollResponse;
      try {
        const response = await fetch(`${this.baseUrl}/nodes/runs/${runId}`, {
          headers: { Authorization: `Bearer ${this.config.MAGICA_API_KEY}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`model poll responded ${response.status}: ${text.slice(0, 300)}`);
        }

        data = (await response.json()) as PollResponse;
      } finally {
        clearTimeout(timeout);
      }

      const status = (data.status ?? '').toUpperCase();
      if (!TERMINAL_STATUSES.has(status)) {
        continue;
      }

      if (FAILED_STATUSES.has(status)) {
        const detail =
          typeof data.error === 'string' ? data.error : JSON.stringify(data.error ?? {});
        throw new Error(`model run ${status}: ${detail.slice(0, 300)}`);
      }

      const content = typeof data.output?.output === 'string' ? data.output.output : '';
      return {
        content: content.trim(),
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    throw new Error('model run timed out while polling');
  }

  private async runAndPoll(input: Record<string, unknown>): Promise<CompletionResult> {
    const runId = await this.startRun(input);
    return this.pollRun(runId);
  }
}

export function createModelProvider(
  config: Pick<
    AppConfig,
    'MAGICA_API_KEY' | 'MAGICA_BASE_URL' | 'MAGICA_MODEL' | 'MODEL_TIMEOUT_MS' | 'MODEL_MAX_RETRIES'
  >,
  logger: Logger,
): ModelProvider {
  return new MagicaProvider(config, logger);
}
