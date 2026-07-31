export type ParticipationMode = 'silent' | 'mentioned_only' | 'balanced' | 'social' | 'chaotic';

export interface ParticipationInput {
  mode: ParticipationMode;
  isPrivate: boolean;
  isMentioned: boolean;
  isReplyToBot: boolean;
  recentAssistantCount: number;
  hourlyAssistantCount: number;
  proactiveRepliesPerHour: number;
  secondsSinceLastReply: number;
  recentlyEngaged: boolean;
  mentionsBotByName: boolean;
}

export interface ParticipationDecision {
  shouldConsiderReply: boolean;
  forced: boolean;
  reason: string;
}

const PROACTIVE_BASE_CHANCE: Record<ParticipationMode, number> = {
  silent: 0,
  mentioned_only: 0,
  balanced: 0.15,
  social: 0.35,
  chaotic: 0.6,
};

export function decideParticipation(input: ParticipationInput): ParticipationDecision {
  if (input.isPrivate) {
    return { shouldConsiderReply: true, forced: true, reason: 'private chat' };
  }

  if (input.isMentioned || input.isReplyToBot) {
    return { shouldConsiderReply: true, forced: true, reason: 'mentioned or replied to' };
  }

  if (input.mentionsBotByName && input.recentlyEngaged) {
    return { shouldConsiderReply: true, forced: false, reason: 'named while recently engaged' };
  }

  if (input.mode === 'silent' || input.mode === 'mentioned_only') {
    return {
      shouldConsiderReply: false,
      forced: false,
      reason: 'mode does not allow proactive replies',
    };
  }

  if (input.hourlyAssistantCount >= input.proactiveRepliesPerHour) {
    return { shouldConsiderReply: false, forced: false, reason: 'hourly proactive limit reached' };
  }

  let chance = PROACTIVE_BASE_CHANCE[input.mode];

  if (input.recentlyEngaged) {
    chance = Math.min(1, chance * 2.5);
  }

  if (input.recentAssistantCount > 0) {
    chance /= 1 + input.recentAssistantCount;
  }

  if (input.secondsSinceLastReply < 60) {
    chance *= 0.25;
  }

  const shouldConsiderReply = Math.random() < chance;
  return {
    shouldConsiderReply,
    forced: false,
    reason: shouldConsiderReply ? 'proactive chance passed' : 'proactive chance failed',
  };
}
