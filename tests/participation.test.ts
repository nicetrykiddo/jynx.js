import { describe, expect, it } from 'vitest';
import { decideParticipation } from '../src/core/participation.js';

describe('decideParticipation', () => {
  it('always considers replying in private chats', () => {
    const decision = decideParticipation({
      mode: 'silent',
      isPrivate: true,
      isMentioned: false,
      isReplyToBot: false,
      recentAssistantCount: 0,
      secondsSinceLastReply: 0,
    });
    expect(decision.shouldConsiderReply).toBe(true);
    expect(decision.forced).toBe(true);
  });

  it('replies when mentioned in a group', () => {
    const decision = decideParticipation({
      mode: 'balanced',
      isPrivate: false,
      isMentioned: true,
      isReplyToBot: false,
      recentAssistantCount: 0,
      secondsSinceLastReply: 999,
    });
    expect(decision.shouldConsiderReply).toBe(true);
    expect(decision.forced).toBe(true);
  });

  it('never proactively replies in silent mode', () => {
    const decision = decideParticipation({
      mode: 'silent',
      isPrivate: false,
      isMentioned: false,
      isReplyToBot: false,
      recentAssistantCount: 0,
      secondsSinceLastReply: 999,
    });
    expect(decision.shouldConsiderReply).toBe(false);
  });
});
