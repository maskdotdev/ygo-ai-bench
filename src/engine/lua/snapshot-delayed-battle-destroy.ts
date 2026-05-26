import { destroyDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaDelayedBattleDestroyCodes = new Set(["85255550", "86100785"]);
const luaPhaseEndEventCode = 0x1200;
const luaResetEventStandard = 0x1fe1000;

export function isKnownDelayedBattleDestroyMarkerEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaDelayedBattleDestroyCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === Number(registryCode) &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.label !== undefined &&
    effect.reset?.flags === luaResetEventStandard
  );
}

export function isKnownDelayedBattleDestroyPhaseEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaDelayedBattleDestroyCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    effect.countLimit === 1
  );
}

export function delayedBattleDestroyPhaseCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  const markerCode = delayedBattleDestroyMarkerCode(effect);
  return (ctx) => markerCode !== undefined && ctx.duel.effects.some((candidate) => (
    candidate.event === "continuous" &&
    candidate.code === markerCode &&
    candidate.sourceUid !== undefined &&
    ctx.duel.cards.some((card) => card.uid === candidate.sourceUid && card.location === "monsterZone")
  ));
}

export function delayedBattleDestroyPhaseOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const markerCode = delayedBattleDestroyMarkerCode(effect);
  return (ctx) => {
    if (markerCode === undefined) return;
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const markers = ctx.duel.effects.filter((candidate) => (
      candidate.event === "continuous" &&
      candidate.code === markerCode &&
      candidate.sourceUid !== undefined &&
      candidate.label !== undefined
    ));
    for (const marker of markers) {
      const target = ctx.duel.cards.find((card) => card.uid === marker.sourceUid);
      if (!target || target.location !== "monsterZone") continue;
      const count = (marker.label ?? 0) + 1;
      marker.label = count;
      if (source) source.turnCounter = count;
      if (count !== 5) continue;
      try {
        destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, marker.ownerPlayer ?? effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
        });
      } catch {
        // EDOPro-style delayed battle markers ignore targets that can no longer be destroyed.
      }
    }
  };
}

function delayedBattleDestroyMarkerCode(effect: SerializedDuelEffect): number | undefined {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return registryCode === undefined ? undefined : Number(registryCode);
}
