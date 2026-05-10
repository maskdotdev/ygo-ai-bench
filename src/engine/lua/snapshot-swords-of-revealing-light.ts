import { destroyDuelCard } from "#duel/core.js";
import { otherPlayer } from "#duel/player-id.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, DuelSession, SerializedDuelEffect } from "#duel/types.js";

const luaSwordsOfRevealingLightCode = "72302403";
const luaSwordsOfRevealingLightResetCode = 1082946;
const luaPhaseEndEventCode = 0x1000 | 0x200;

export function isKnownSwordsOfRevealingLightPhaseEndEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaSwordsOfRevealingLightCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.countLimit === 1 &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone"
  );
}

export function isKnownSwordsOfRevealingLightResetEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaSwordsOfRevealingLightCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaSwordsOfRevealingLightResetCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined
  );
}

export function swordsOfRevealingLightPhaseEndOperation(): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const nextCounter = (ctx.source.turnCounter ?? 0) + 1;
    ctx.source.turnCounter = nextCounter;
    if (nextCounter === 3) {
      destroyDuelCard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.rule | duelReason.destroy, ctx.player);
    }
  };
}

export function swordsOfRevealingLightPhaseEndCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => ctx.duel.turnPlayer === otherPlayer(effect.controller);
}

export function swordsOfRevealingLightRestoredReset(session: DuelSession, effect: SerializedDuelEffect): DuelEffectDefinition["reset"] | undefined {
  if (!effect.reset) return undefined;
  const source = session.state.cards.find((card) => card.uid === effect.sourceUid);
  const remaining = Math.max(1, 3 - (source?.turnCounter ?? 0));
  return { ...effect.reset, count: Math.max(effect.reset.count ?? remaining, remaining) };
}
