import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ModelProvider,
  ToolCall,
  ToolDefinition,
} from './types.js';

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChoice {
  message?: {
    content?: string | null;
    tool_calls?: OpenAiToolCall[];
  };
  finish_reason?: string;
}

interface OpenAiResponse {
  choices?: OpenAiChoice[];
}

function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      };
    }
    return { role: message.role, content: message.content, name: message.name };
  });
}

function toOpenAiTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(rawCalls: OpenAiToolCall[] | undefined): ToolCall[] {
  if (!rawCalls) {
    return [];
  }

  const calls: ToolCall[] = [];
  for (const raw of rawCalls) {
    const name = raw.function?.name;
    if (!name) {
      continue;
    }

    let args: Record<string, unknown> = {};
    const rawArgs = raw.function?.arguments;
    if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object') {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    }

    calls.push({ id: raw.id ?? name, name, arguments: args });
  }

  return calls;
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
    const url = `${this.config.MAGICA_BASE_URL.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.MAGICA_MODEL,
      messages: toOpenAiMessages(request.messages),
      temperature: request.temperature ?? 0.8,
    };

    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = toOpenAiTools(request.tools);
      body.tool_choice = 'auto';
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.MODEL_MAX_RETRIES; attempt += 1) {
      try {
        return await this.request(url, body);
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

  private async request(url: string, body: unknown): Promise<CompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.MAGICA_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`model responded ${response.status}: ${text.slice(0, 500)}`);
      }

      const data = (await response.json()) as OpenAiResponse;
      const choice = data.choices?.[0];
      const message = choice?.message;

      return {
        content: (message?.content ?? '').trim(),
        toolCalls: parseToolCalls(message?.tool_calls),
        finishReason: choice?.finish_reason ?? 'stop',
      };
    } finally {
      clearTimeout(timeout);
    }
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
