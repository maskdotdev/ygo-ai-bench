import { currentBattleStep } from "#duel/battle-window-state.js";
import { cardTypeFlags, currentAttack, currentAttackWithoutEffect } from "#duel/card-stats.js";
import type { DuelEffectDefinition } from "#duel/types.js";

export function luaValueDescriptorStatValue(luaValueDescriptor: string | undefined, effectId: string): DuelEffectDefinition["statValue"] | undefined {
  if (luaValueDescriptor === "stat:all-grave-monster-count-x100") {
    return (ctx) => ctx.duel.cards.filter((card) => card.location === "graveyard" && (cardTypeFlags(card, ctx.duel) & 0x1) !== 0).length * 100;
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
