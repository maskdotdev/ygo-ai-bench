import { changeDuelCardPosition, drawDuelCards } from "#duel/core.js";
import { duelLocations } from "#duel/location-kinds.js";
import type { DuelEffectContext, DuelEffectDefinition, DuelState, SerializedDuelEffect } from "#duel/types.js";

const luaBookOfEclipseCode = "35480699";
const luaPhaseEndEventCode = 0x1200;
const luaPhaseEndResetFlags = 0x40000200;

export function isKnownBookOfEclipsePhaseEndEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaBookOfEclipseCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.targetRange === undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function bookOfEclipsePhaseEndCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => faceDownOpponentMonsters(ctx.duel, effect.controller).length > 0;
}

export function bookOfEclipsePhaseEndOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const targets = faceDownOpponentMonsters(ctx.duel, effect.controller);
    let changed = 0;
    for (const target of targets) {
      try {
        changeDuelCardPosition(ctx.duel, target.controller, target.uid, "faceUpDefense");
        changed += 1;
      } catch {
        // EDOPro-style delayed operations ignore cards that are no longer legal at resolution.
      }
    }
    if (changed > 0) drawDuelCards(ctx.duel, opponent(effect.controller), changed, "Book of Eclipse draw", {
      eventReason: 0x40,
      eventReasonPlayer: effect.controller,
      eventReasonCardUid: effect.sourceUid,
    });
  };
}

function faceDownOpponentMonsters(state: DuelState, controller: DuelEffectContext["player"] | undefined) {
  const targetPlayer = opponent(controller);
  return state.cards.filter((card) => card.controller === targetPlayer && card.location === "monsterZone" && !card.faceUp);
}

function opponent(player: DuelEffectContext["player"] | undefined): 0 | 1 {
  return player === 1 ? 0 : 1;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
