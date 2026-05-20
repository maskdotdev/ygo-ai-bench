import { destroyDuelCard, moveDuelCardWithRedirects } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaPhaseEndEventCode = 0x1200;
const luaResetsStandardPhaseEnd = 0x41fe1200;
const luaResetsStandardPhaseEndRuntime = luaResetsStandardPhaseEnd & ~0x1000;
const luaSelfEndPhaseDestroyCodes = new Set(["23289281", "55696885"]);
const luaSelfEndPhaseSendCodes = new Set(["71071546"]);

export function isKnownSelfEndPhaseDestroyEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaSelfEndPhaseDestroyCodes.has(registryCode) &&
    (effect.event === "continuous" || effect.event === "trigger") &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.countLimit === 1 &&
    (effect.reset?.flags === luaResetsStandardPhaseEnd || effect.reset?.flags === luaResetsStandardPhaseEndRuntime)
  );
}

export function selfEndPhaseDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    try {
      destroyDuelCard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer be destroyed.
    }
  };
}

export function isKnownSelfEndPhaseSendEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaSelfEndPhaseSendCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.countLimit === 1 &&
    effect.triggerEvent === "phaseEnd"
  );
}

export function selfEndPhaseSendOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    try {
      moveDuelCardWithRedirects(ctx.duel, ctx.source.uid, "graveyard", ctx.source.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer be sent.
    }
  };
}

function effectReasonIdPayload(effect: SerializedDuelEffect): { eventReasonEffectId: number } | Record<string, never> {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? { eventReasonEffectId: id } : {};
}
