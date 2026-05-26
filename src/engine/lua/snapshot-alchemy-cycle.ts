import { drawDuelCards } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaAlchemyCycleCode = "65384019";

export function isKnownAlchemyCycleBattleDestroyedDrawEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaAlchemyCycleCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1140 &&
    effect.triggerEvent === "battleDestroyed" &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    effect.reset !== undefined;
}

export function alchemyCycleBattleDestroyedDrawConditionCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "canActivate"> {
  return {
    canActivate: (ctx) =>
      ctx.duel.flagEffects.some(
        (flag) =>
          flag.ownerType === "card" &&
          flag.ownerId === ctx.eventCard?.uid &&
          flag.code === Number(luaAlchemyCycleCode) &&
          flag.value === effect.label,
      ),
  };
}

export function alchemyCycleBattleDestroyedDrawOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    drawDuelCards(ctx.duel, effect.controller, 1, "Alchemy Cycle draw", {
      eventReason: duelReason.effect,
      eventReasonPlayer: effect.controller,
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}
