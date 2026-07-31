import { describe, expect, it, vi } from 'vitest';
import { IntentDetector } from '../src/agent/intent.js';
import type { CompletionResult, ModelProvider } from '../src/model/types.js';

function makeModel(content: string): ModelProvider {
  return {
    name: 'mock',
    complete: vi.fn(async (): Promise<CompletionResult> => ({
      content,
      toolCalls: [],
      finishReason: 'stop',
    })),
  };
}

describe('IntentDetector', () => {
  it('detects a proposal from valid JSON', async () => {
    const model = makeModel(
      JSON.stringify({
        isProposal: true,
        kind: 'feature',
        title: 'Add a weather command',
        summary: 'Owner wants a /weather command.',
        access: 'public',
      }),
    );
    const detector = new IntentDetector(model);
    const result = await detector.detect('can you add a weather command');
    expect(result.isProposal).toBe(true);
    expect(result.kind).toBe('feature');
    expect(result.title).toBe('Add a weather command');
  });

  it('returns non-proposal for casual chat', async () => {
    const model = makeModel(
      JSON.stringify({ isProposal: false, kind: 'other', title: '', summary: '' }),
    );
    const detector = new IntentDetector(model);
    const result = await detector.detect('yo how are you');
    expect(result.isProposal).toBe(false);
  });

  it('falls back safely on malformed model output', async () => {
    const model = makeModel('not json at all');
    const detector = new IntentDetector(model);
    const result = await detector.detect('anything');
    expect(result.isProposal).toBe(false);
  });

  it('ignores proposals missing title or summary', async () => {
    const model = makeModel(
      JSON.stringify({ isProposal: true, kind: 'feature', title: '', summary: '' }),
    );
    const detector = new IntentDetector(model);
    const result = await detector.detect('do something');
    expect(result.isProposal).toBe(false);
  });

  it('rejects private introspection outside a trusted owner chat', async () => {
    const model = makeModel(
      JSON.stringify({
        isProposal: true,
        kind: 'action',
        title: 'Show database stats',
        summary: 'Read private database statistics.',
        access: 'trusted',
      }),
    );
    const detector = new IntentDetector(model);
    const result = await detector.detect('show me the db stats', {
      requesterRole: 'user',
      trustedChannel: false,
      assistantReply: 'ask me in owner DMs',
    });
    expect(result.isProposal).toBe(false);
  });
});
