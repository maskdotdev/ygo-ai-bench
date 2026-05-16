import { changeDuelCardPosition, moveDuelCardWithRedirects } from "#duel/core.js";
import { resetDuelCardEffects } from "#duel/effect-reset.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaEffectGeminiStatus = 75;
const luaBattlePhaseEventCode = 0x1000 | 0x80;
const luaPhaseEndEventCode = 0x1000 | 0x200;
const luaPhaseEndResetFlags = 0x40000000 | 0x200;
const luaYellowAlertCode = "59277750";
const luaUnleashYourPowerCode = "73567374";
const luaTsumuhaKutsunagiCode = "78098950";

export function isKnownYellowAlertDelayedReturnEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaYellowAlertCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaBattlePhaseEventCode &&
    effect.label !== undefined &&
    effect.targetRange === undefined
  );
}

export function yellowAlertDelayedReturnOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const fieldId = effect.label;
    const flagCode = Number(ctx.source.code);
    if (fieldId === undefined || !Number.isSafeInteger(flagCode)) return;
    const targetUids = ctx.duel.flagEffects.filter((flag) => flag.ownerType === "card" && flag.code === flagCode && flag.value === fieldId).map((flag) => flag.ownerId);
    for (const uid of [...new Set(targetUids)]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, { eventReasonCardUid: ctx.source.uid });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer move.
      }
    }
  };
}

export function isKnownUnleashYourPowerDelayedSetEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaUnleashYourPowerCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.triggerEvent === "phaseEnd" &&
    effect.triggerCode === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaTsumuhaKutsunagiCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.triggerEvent === "phaseEnd" &&
    effect.triggerCode === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function tsumuhaKutsunagiDelayedShuffleOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const targetUids = ctx.duel.cards
      .filter((card) => card.location === "monsterZone" || card.location === "spellTrapZone" || card.location === "graveyard" || card.location === "banished")
      .sort((left, right) => left.controller - right.controller || left.sequence - right.sequence || left.uid.localeCompare(right.uid))
      .map((card) => card.uid);
    for (const uid of targetUids) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        moveDuelCardWithRedirects(ctx.duel, target.uid, "deck", target.controller, duelReason.effect, effect.controller, {
          eventReasonCardUid: effect.sourceUid,
        });
      } catch {
        // EDOPro-style delayed operations ignore cards that can no longer move.
      }
    }
  };
}

export function unleashYourPowerDelayedSetOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const fieldId = effect.label;
    if (fieldId === undefined) return;
    const targetUids = ctx.duel.flagEffects
      .filter((flag) => flag.ownerType === "card" && flag.code === Number(luaUnleashYourPowerCode) && flag.value === fieldId)
      .map((flag) => flag.ownerId);
    for (const uid of [...new Set(targetUids)]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        changeDuelCardPosition(ctx.duel, target.controller, target.uid, "faceDownDefense");
        resetDuelCardEffects(ctx.duel, target, (candidate) => candidate.code === luaEffectGeminiStatus);
      } catch {
        // EDOPro-style delayed operations ignore targets that are no longer position-change legal.
      }
    }
  };
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
