import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { canMoveDuelCardToLocation, sendDuelCardToGraveyard } from "#duel/core.js";
import { currentBattleStep } from "#duel/battle-window-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectContext, DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaResetsStandardPhaseEnd = 0x41fe1200;

export function isKnownAssaultSpiritsDamageStepEquipEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:87043568:")) && effect.event === "quick" && effect.code === 1002 && effect.property === 0x4000 && effect.range.length === 1 && effect.range[0] === "spellTrapZone" && effect.reset !== undefined;
}

export function assaultSpiritsDamageStepEquipCondition(): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    const step = currentBattleStep(ctx.duel);
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    return Boolean(ctx.duel.phase === "battle" && step === "damage" && battle?.attackerUid === ctx.source.equippedToUid);
  };
}

export function assaultSpiritsDamageStepEquipCost(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["cost"]> {
  return (ctx) => {
    const cost = ctx.duel.cards
      .filter((card) => card.controller === ctx.player && card.location === "hand" && (cardTypeFlags(card, ctx.duel) & 0x1) !== 0 && currentAttack(card, ctx.duel) <= 1000 && canMoveDuelCardToLocation(ctx.duel, card.uid, "graveyard", duelReason.cost))
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (!cost) return false;
    if (ctx.checkOnly) return true;
    const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
    ctx.effectLabel = currentAttack(cost, ctx.duel);
    sendDuelCardToGraveyard(ctx.duel, cost.uid, cost.controller, duelReason.cost, ctx.player, {
      eventReasonCardUid: ctx.source.uid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
    return true;
  };
}

export function assaultSpiritsDamageStepEquipOperation(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["operation"]> {
  return (ctx: DuelEffectContext) => {
    const attackerUid = ctx.duel.currentAttack?.attackerUid ?? ctx.duel.pendingBattle?.attackerUid;
    const attacker = attackerUid ? ctx.duel.cards.find((card) => card.uid === attackerUid) : undefined;
    const value = ctx.chainLink?.effectLabel ?? effect.label;
    if (!attacker || !attacker.faceUp || typeof value !== "number") return;
    ctx.duel.effects.push({ id: `${effect.id}-attack-boost`, event: "continuous", code: 100, controller: effect.controller, sourceUid: attacker.uid, registryKey: `${effect.registryKey}:attack-boost`, range: ["monsterZone"], reset: { flags: luaResetsStandardPhaseEnd }, value, operation: () => {} });
  };
}
