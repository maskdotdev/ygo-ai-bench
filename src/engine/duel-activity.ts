import type { DuelActivityCounts, DuelState, PlayerId } from "./duel-types.js";

export const duelActivity = {
  summon: 0x1,
  normalSummon: 0x2,
  specialSummon: 0x4,
  flipSummon: 0x8,
  attack: 0x10,
} as const;

export function createDuelActivityCounts(): Record<PlayerId, DuelActivityCounts> {
  return {
    0: emptyActivityCounts(),
    1: emptyActivityCounts(),
  };
}

export function resetDuelActivityCounts(state: DuelState, player: PlayerId): void {
  state.activityCounts[player] = emptyActivityCounts();
}

export function copyDuelActivityCounts(counts: Record<PlayerId, DuelActivityCounts> | undefined): Record<PlayerId, DuelActivityCounts> {
  const source = counts ?? createDuelActivityCounts();
  return {
    0: { ...source[0] },
    1: { ...source[1] },
  };
}

export function getDuelActivityCount(state: DuelState, player: PlayerId, activity: number): number {
  const counts = state.activityCounts[player];
  if (activity === duelActivity.summon) return counts.summon;
  if (activity === duelActivity.normalSummon) return counts.normalSummon;
  if (activity === duelActivity.specialSummon) return counts.specialSummon;
  if (activity === duelActivity.flipSummon) return counts.flipSummon;
  if (activity === duelActivity.attack) return counts.attack;
  return 0;
}

export function recordNormalSummonActivity(state: DuelState, player: PlayerId): void {
  state.activityCounts[player].normalSummon += 1;
  state.activityCounts[player].summon += 1;
}

export function recordNormalSetActivity(state: DuelState, player: PlayerId): void {
  state.activityCounts[player].normalSummon += 1;
}

export function recordSpecialSummonActivity(state: DuelState, player: PlayerId): void {
  state.activityCounts[player].specialSummon += 1;
  state.activityCounts[player].summon += 1;
}

export function recordFlipSummonActivity(state: DuelState, player: PlayerId): void {
  state.activityCounts[player].flipSummon += 1;
  state.activityCounts[player].summon += 1;
}

export function recordAttackActivity(state: DuelState, player: PlayerId): void {
  state.activityCounts[player].attack += 1;
}

function emptyActivityCounts(): DuelActivityCounts {
  return {
    summon: 0,
    normalSummon: 0,
    specialSummon: 0,
    flipSummon: 0,
    attack: 0,
  };
}
