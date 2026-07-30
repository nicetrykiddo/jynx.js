import type { AppConfig } from '../config.js';
import type { Identity } from './auth.js';
import { buildSystemPrompt } from './persona.js';
import type { ModelProvider, ChatMessage } from '../model/types.js';
import type { Repository } from '../storage/repository.js';
import type { Message } from '../storage/schema.js';
import type { WebSearchService } from '../agent/websearch.js';

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
      | 'MAX_HISTORY_MESSAGES'
      | 'MAX_GROUP_CONTEXT_MESSAGES'
      | 'MAX_RESPONSE_CHARS'
      | 'JYNX_TIMEZONE'
    >,
    private readonly repository: Repository,
    private readonly model: ModelProvider,
    private readonly webSearch?: WebSearchService,
  ) {}

  private referencesPast(text: string): boolean {
    const lower = text.toLowerCase();
    const triggers = [
      'earlier',
      'before',
      'yesterday',
      'last time',
      'you said',
      'i said',
      'we talked',
      'remember',
      'that thing',
      'back then',
      'previously',
      'the other day',
      'who said',
      'what did',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private searchTerms(text: string): string[] {
    const stop = new Set([
      'the','a','an','and','or','but','if','of','to','in','on','at','for','with','about','you','i','we','said','earlier','before','remember','what','who','did','that','this','was','were','is','are','do','does','me','my','your',
    ]);
    return [
      ...new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3 && !stop.has(w)),
      ),
    ].slice(0, 5);
  }

  private needsFactCheck(text: string): boolean {
    const lower = text.toLowerCase();
    const triggers = [
      'latest',
      'news',
      'today',
      'current',
      'right now',
      'price',
      'score',
      'weather',
      'who is',
      'when is',
      'when did',
      'how old',
      'release date',
      'is it true',
      'fact check',
      'this year',
      'recently',
    ];
    return triggers.some((t) => lower.includes(t)) || /\b20\d{2}\b/.test(lower);
  }

  private currentTime(): string {
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: this.config.JYNX_TIMEZONE,
      }).format(new Date());
    } catch {
      return new Date().toISOString();
    }
  }

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
      currentTime: this.currentTime(),
      timezone: this.config.JYNX_TIMEZONE,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyToChatMessages(history, isGroup),
    ];

    const userContent = isGroup
      ? `${input.displayName}: ${input.userText}`
      : input.userText;

    if (this.referencesPast(input.userText)) {
      try {
        const seen = new Set(history.map((m) => m.id));
        const terms = this.searchTerms(input.userText);
        const found: Message[] = [];
        for (const term of terms) {
          const rows = await this.repository.searchMessages(input.chatId, term, 10);
          for (const row of rows) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              found.push(row);
            }
          }
        }
        if (found.length > 0) {
          const recalled = found
            .slice(-15)
            .map((m) => {
              const meta = (m.metadata ?? {}) as { displayName?: string };
              const who = m.role === 'assistant' ? 'Jynx' : (meta.displayName ?? 'someone');
              return `- ${who}: ${m.content.slice(0, 300)}`;
            })
            .join('\n');
          messages.push({
            role: 'system',
            content: `Relevant earlier messages from this chat you recalled (use naturally, do not quote verbatim unless asked):\n${recalled}`,
          });
        }
      } catch {
        // history recall is best-effort; ignore failures
      }
    }

    if (this.webSearch?.isConfigured && this.needsFactCheck(input.userText)) {
      try {
        const results = await this.webSearch.search(input.userText);
        if (results.length > 0) {
          const context = results
            .map((r) => `- ${r.title}: ${r.snippet} (${r.url})`)
            .join('\n');
          messages.push({
            role: 'system',
            content: `Web search results for the user's message (use to fact-check, cite naturally, do not dump raw):\n${context}`,
          });
        }
      } catch {
        // web search is best-effort; ignore failures
      }
    }

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
