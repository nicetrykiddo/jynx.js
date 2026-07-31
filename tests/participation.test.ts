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
      hourlyAssistantCount: 0,
      proactiveRepliesPerHour: 4,
      secondsSinceLastReply: 0,
      recentlyEngaged: false,
      mentionsBotByName: false,
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
      hourlyAssistantCount: 4,
      proactiveRepliesPerHour: 4,
      secondsSinceLastReply: 999,
      recentlyEngaged: false,
      mentionsBotByName: false,
    });
    expect(decision.shouldConsiderReply).toBe(true);
    expect(decision.forced).toBe(true);
  });

  it('replies when named while recently engaged', () => {
    const decision = decideParticipation({
      mode: 'balanced',
      isPrivate: false,
      isMentioned: false,
      isReplyToBot: false,
      recentAssistantCount: 0,
      hourlyAssistantCount: 0,
      proactiveRepliesPerHour: 4,
      secondsSinceLastReply: 30,
      recentlyEngaged: true,
      mentionsBotByName: true,
    });
    expect(decision.shouldConsiderReply).toBe(true);
  });

  it('never proactively replies in silent mode', () => {
    const decision = decideParticipation({
      mode: 'silent',
      isPrivate: false,
      isMentioned: false,
      isReplyToBot: false,
      recentAssistantCount: 0,
      hourlyAssistantCount: 0,
      proactiveRepliesPerHour: 4,
      secondsSinceLastReply: 999,
      recentlyEngaged: false,
      mentionsBotByName: false,
    });
    expect(decision.shouldConsiderReply).toBe(false);
  });

  it('stops proactive replies at the configured hourly limit', () => {
    const decision = decideParticipation({
      mode: 'chaotic',
      isPrivate: false,
      isMentioned: false,
      isReplyToBot: false,
      recentAssistantCount: 0,
      hourlyAssistantCount: 4,
      proactiveRepliesPerHour: 4,
      secondsSinceLastReply: 999,
      recentlyEngaged: false,
      mentionsBotByName: false,
    });
    expect(decision.reason).toBe('hourly proactive limit reached');
  });
});
