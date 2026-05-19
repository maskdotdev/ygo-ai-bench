import { currentBattleStep } from "#duel/battle-window-state.js";
import { cardTypeFlags, currentAttack, currentAttackWithoutEffect, currentDefense, currentLevel, currentRank } from "#duel/card-stats.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { locationsFromMask } from "#lua/api-utils.js";

export function luaValueDescriptorStatValue(luaValueDescriptor: string | undefined, effectId: string): DuelEffectDefinition["statValue"] | undefined {
  if (luaValueDescriptor === "stat:all-grave-monster-count-x100") {
    return (ctx) => ctx.duel.cards.filter((card) => card.location === "graveyard" && (cardTypeFlags(card, ctx.duel) & 0x1) !== 0).length * 100;
  }
  if (luaValueDescriptor === "stat:current-defense") return (ctx, card) => currentDefense(card, ctx.duel);
  const levelOrRank = luaValueDescriptor?.match(/^stat:level-or-rank:x(-?\d+)$/);
  if (levelOrRank?.[1]) {
    const multiplier = Number(levelOrRank[1]);
    if (Number.isSafeInteger(multiplier)) {
      return (ctx, card) => ((cardTypeFlags(card, ctx.duel) & 0x800000) !== 0 ? currentRank(card, ctx.duel) : currentLevel(card, ctx.duel)) * multiplier;
    }
  }
  const fieldGroupCount = luaValueDescriptor?.match(/^stat:controller-field-group-count:(\d+):(\d+):x(-?\d+)$/);
  if (fieldGroupCount?.[1] && fieldGroupCount[2] && fieldGroupCount[3]) {
    const selfMask = Number(fieldGroupCount[1]);
    const opponentMask = Number(fieldGroupCount[2]);
    const multiplier = Number(fieldGroupCount[3]);
    if (Number.isSafeInteger(selfMask) && Number.isSafeInteger(opponentMask) && Number.isSafeInteger(multiplier)) {
      const selfLocations = locationsFromMask(selfMask);
      const opponentLocations = locationsFromMask(opponentMask);
      return (ctx, card) => {
        const opponent = card.controller === 0 ? 1 : 0;
        return ctx.duel.cards.filter((candidate) =>
          (candidate.controller === card.controller && selfLocations.includes(candidate.location)) ||
          (candidate.controller === opponent && opponentLocations.includes(candidate.location))
        ).length * multiplier;
      };
    }
  }
  const battleAttackerTargetSwing = luaValueDescriptor?.match(/^stat:battle-attacker-target-swing:(-?\d+):(-?\d+)$/);
  if (battleAttackerTargetSwing?.[1] && battleAttackerTargetSwing[2]) {
    const attackingValue = Number(battleAttackerTargetSwing[1]);
    const defendingValue = Number(battleAttackerTargetSwing[2]);
    if (Number.isSafeInteger(attackingValue) && Number.isSafeInteger(defendingValue)) {
      return (ctx, card) => {
        const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
        if (battle?.attackerUid === card.uid && battle.targetUid) return attackingValue;
        if (battle?.targetUid === card.uid) return defendingValue;
        return 0;
      };
    }
  }
  if (luaValueDescriptor === "stat:damage-calculation-attacker-lower-than-target:+1000") {
    return (ctx, card) => {
      if (ctx.duel.phase !== "battle" || currentBattleStep(ctx.duel) !== "damageCalculation") return 0;
      const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
      if (battle?.attackerUid !== card.uid || !battle.targetUid) return 0;
      const target = ctx.duel.cards.find((candidate) => candidate.uid === battle.targetUid);
      if (!target) return 0;
      return currentAttackWithoutEffect(card, ctx.duel, effectId) < currentAttack(target, ctx.duel) ? 1000 : 0;
    };
  }
  return undefined;
}
