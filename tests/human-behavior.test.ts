import { describe, expect, it } from 'vitest';
import {
  allowWithinWindow,
  customEmojiReply,
  isLowInformationMessage,
} from '../src/telegram/bot.js';

describe('human-like Telegram behavior', () => {
  it('limits a user within a rolling window', () => {
    const entries = new Map<number, number[]>();
    expect(allowWithinWindow(entries, 7, 2, 1000, 1000)).toBe(true);
    expect(allowWithinWindow(entries, 7, 2, 1000, 1100)).toBe(true);
    expect(allowWithinWindow(entries, 7, 2, 1000, 1200)).toBe(false);
    expect(allowWithinWindow(entries, 7, 2, 1000, 2101)).toBe(true);
  });

  it('uses configured custom emoji sparingly', () => {
    expect(customEmojiReply('hey', ['123'], 1, false)).toBe('hey');
    expect(customEmojiReply('hey', ['123'], 5, false)).toContain('emoji-id="123"');
  });

  it('does not send punctuation-only nudges to the model', () => {
    expect(isLowInformationMessage('.')).toBe(true);
    expect(isLowInformationMessage('.....')).toBe(true);
    expect(isLowInformationMessage('..?!')).toBe(true);
    expect(isLowInformationMessage('still waiting')).toBe(false);
  });
});
