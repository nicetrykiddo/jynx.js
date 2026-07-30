import type { AppConfig } from '../config.js';
import type { Identity } from './auth.js';
import { buildSystemPrompt } from './persona.js';
import type { ModelProvider, ChatMessage } from '../model/types.js';
import type { Repository } from '../storage/repository.js';
import type { Message } from '../storage/schema.js';

export interface ConversationInput {
  identity: Identity;
  chatId: number;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  userText: string;
  displayName: string;
}

export interface ConversationResult {
  reply: string;
}

function historyToChatMessages(history: Message[], selfIsGroup: boolean): ChatMessage[] {
  return history.map((message) => {
    if (message.role === 'assistant') {
      return { role: 'assistant', content: message.content };
    }
    const meta = (message.metadata ?? {}) as { displayName?: string };
    const prefix = selfIsGroup && meta.displayName ? `${meta.displayName}: ` : '';
    return { role: 'user', content: `${prefix}${message.content}` };
  });
}

export class ConversationService {
  public constructor(
    private readonly config: Pick<
      AppConfig,
      'MAX_HISTORY_MESSAGES' | 'MAX_GROUP_CONTEXT_MESSAGES' | 'MAX_RESPONSE_CHARS'
    >,
    private readonly repository: Repository,
    private readonly model: ModelProvider,
  ) {}

  public async respond(input: ConversationInput): Promise<ConversationResult> {
    const isGroup = input.chatType === 'group' || input.chatType === 'supergroup';
    const limit = isGroup
      ? this.config.MAX_GROUP_CONTEXT_MESSAGES
      : this.config.MAX_HISTORY_MESSAGES;

    const history = await this.repository.getRecentMessages(input.chatId, limit);
    const memories = await this.repository.getMemories(
      isGroup ? input.chatId : null,
      input.identity.userId,
    );

    const systemPrompt = buildSystemPrompt({
      identity: input.identity,
      chatType: input.chatType,
      memories,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyToChatMessages(history, isGroup),
    ];

    const userContent = isGroup
      ? `${input.displayName}: ${input.userText}`
      : input.userText;
    messages.push({ role: 'user', content: userContent });

    const result = await this.model.complete({ messages, temperature: 0.85 });
    let reply = result.content.trim();

    if (reply.length > this.config.MAX_RESPONSE_CHARS) {
      reply = reply.slice(0, this.config.MAX_RESPONSE_CHARS);
    }

    if (reply.length === 0) {
      reply = '...';
    }

    return { reply };
  }
}
