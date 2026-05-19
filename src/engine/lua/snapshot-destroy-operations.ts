import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { destroyDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

export function luaHandlerDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    try {
      destroyDuelCard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
      });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer be destroyed.
    }
  };
}

export function luaLinkedLeaveFieldDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (ctx) => {
    const eventUids = ctx.eventUids ?? (ctx.eventCard ? [ctx.eventCard.uid] : []);
    const linkedCardLeft = registryCode !== undefined && eventUids.some((uid) => {
      const card = ctx.duel.cards.find((candidate) => candidate.uid === uid);
      return Boolean(card && currentCardMatchesCode(card, ctx.duel, registryCode));
    });
    if (!linkedCardLeft) return;
    try {
      destroyDuelCard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
      });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer be destroyed.
    }
  };
}
