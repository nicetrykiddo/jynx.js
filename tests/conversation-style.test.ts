import { describe, expect, it } from 'vitest';
import { normalizeReply } from '../src/core/conversation.js';
import { buildSystemPrompt } from '../src/core/persona.js';
import { parseNaturalEdit } from '../src/telegram/bot.js';

describe('conversation safety and style', () => {
  it('removes blank-line assistant formatting', () => {
    expect(normalizeReply('first\n\n\nsecond\r\n\r\nthird')).toBe('first\nsecond\nthird');
  });

  it('never trusts a non-owner just because they are in a trusted group', () => {
    const prompt = buildSystemPrompt({
      identity: { userId: 2, role: 'user', isOwner: false, isAdmin: false },
      chatType: 'supergroup',
      trustedChannel: true,
    });
    expect(prompt).toContain('This is NOT a trusted channel');
  });

  it('parses a natural edit only when it is explicitly phrased as one', () => {
    expect(parseNaturalEdit('edit this to nah that was wrong')).toBe('nah that was wrong');
    expect(parseNaturalEdit('i might edit this later')).toBeNull();
  });
});
