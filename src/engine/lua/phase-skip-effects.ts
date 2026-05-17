import type { DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "#duel/types.js";
import { phaseMask } from "#duel/phase-mask.js";
import { normalizeResetFlags, resetPhase } from "#duel/reset-flags.js";

const luaEffectSkipDrawPhase = 180;

export function materializeSkipDrawPhaseEffect(session: DuelSession, source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  if (effect.event !== "continuous" || effect.code !== luaEffectSkipDrawPhase || effect.targetRange === undefined) return false;
  let applied = false;
  const remaining = materializedDrawSkipCount(effect);
  for (const player of [0, 1] satisfies PlayerId[]) {
    if (!effectTargetsPlayer(effect, source, player)) continue;
    const existing = session.state.skippedPhases.find((skip) => skip.player === player && skip.phase === "draw");
    if (existing) existing.remaining = Math.max(existing.remaining, remaining);
    else session.state.skippedPhases.push({ player, phase: "draw", remaining });
    applied = true;
  }
  return applied;
}

function materializedDrawSkipCount(effect: DuelEffectDefinition): number {
  const reset = effect.reset;
  if (!reset) return 1;
  const flags = normalizeResetFlags(reset.flags);
  if ((flags & resetPhase) === 0) return 1;
  const count = Math.max(1, reset.count ?? 1);
  if ((flags & phaseMask("draw")) !== 0) return Math.max(1, count - 1);
  if ((flags & phaseMask("end")) !== 0) return Math.max(1, Math.floor(count / 2));
  return 1;
}

function effectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  return source.controller === player ? selfTarget !== 0 : opponentTarget !== 0;
}
