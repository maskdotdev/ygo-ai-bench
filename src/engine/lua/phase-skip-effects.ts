import type { DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "#duel/types.js";

const luaEffectSkipDrawPhase = 180;

export function materializeSkipDrawPhaseEffect(session: DuelSession, source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  if (effect.event !== "continuous" || effect.code !== luaEffectSkipDrawPhase || effect.targetRange === undefined) return false;
  let applied = false;
  for (const player of [0, 1] satisfies PlayerId[]) {
    if (!effectTargetsPlayer(effect, source, player)) continue;
    const existing = session.state.skippedPhases.find((skip) => skip.player === player && skip.phase === "draw");
    if (existing) existing.remaining = Math.max(existing.remaining, 1);
    else session.state.skippedPhases.push({ player, phase: "draw", remaining: 1 });
    applied = true;
  }
  return applied;
}

function effectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  return source.controller === player ? selfTarget !== 0 : opponentTarget !== 0;
}
