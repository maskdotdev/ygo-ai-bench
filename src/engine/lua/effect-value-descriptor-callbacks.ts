import { currentBattleStep } from "#duel/battle-window-state.js";
import { cardTypeFlags, currentAttack, currentAttackWithoutEffect, currentBaseAttack, currentBaseDefense, currentDefense, currentLeftScale, currentLevel, currentLink, currentRace, currentRank } from "#duel/card-stats.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { locationsFromMask } from "#lua/api-utils.js";

export function luaValueDescriptorStatValue(luaValueDescriptor: string | undefined, effectId: string): DuelEffectDefinition["statValue"] | undefined {
  if (luaValueDescriptor === "stat:all-grave-monster-count-x100") {
    return (ctx) => ctx.duel.cards.filter((card) => card.location === "graveyard" && (cardTypeFlags(card, ctx.duel) & 0x1) !== 0).length * 100;
  }
  if (luaValueDescriptor === "stat:current-defense") return (ctx, card) => currentDefense(card, ctx.duel);
  const currentScale = luaValueDescriptor?.match(/^stat:current-scale:x(-?\d+)$/);
  if (currentScale?.[1]) {
    const multiplier = Number(currentScale[1]);
    if (Number.isSafeInteger(multiplier)) return (ctx, card) => currentLeftScale(card, ctx.duel) * multiplier;
  }
  if (luaValueDescriptor === "stat:self-flag-base-attack-zero-double-else-half") {
    return (ctx, card) => hasSelfCodeFlag(ctx, card) ? currentBaseAttack(card, ctx.duel, effectId) / 2 : currentBaseAttack(card, ctx.duel, effectId) * 2;
  }
  if (luaValueDescriptor === "stat:self-flag-base-defense-zero-double-else-half") {
    return (ctx, card) => hasSelfCodeFlag(ctx, card) ? currentBaseDefense(card, ctx.duel, effectId) / 2 : currentBaseDefense(card, ctx.duel, effectId) * 2;
  }
  const handlerEquipCount = luaValueDescriptor?.match(/^stat:handler-equip-count:x(-?\d+)$/);
  if (handlerEquipCount?.[1]) {
    const multiplier = Number(handlerEquipCount[1]);
    if (Number.isSafeInteger(multiplier)) {
      return (ctx) => ctx.duel.cards.filter((candidate) => candidate.equippedToUid === ctx.source.uid).length * multiplier;
    }
  }
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
  const fieldGroupCountThreshold = luaValueDescriptor?.match(/^stat:controller-field-group-count-threshold:(\d+):(\d+):lte(-?\d+):(-?\d+):gte(-?\d+):(-?\d+):else(-?\d+)$/);
  if (fieldGroupCountThreshold?.[1] && fieldGroupCountThreshold[2] && fieldGroupCountThreshold[3] && fieldGroupCountThreshold[4] && fieldGroupCountThreshold[5] && fieldGroupCountThreshold[6] && fieldGroupCountThreshold[7]) {
    const [selfMask, opponentMask, lte, lteValue, gte, gteValue, elseValue] = fieldGroupCountThreshold.slice(1, 8).map(Number);
    if ([selfMask, opponentMask, lte, lteValue, gte, gteValue, elseValue].every(Number.isSafeInteger)) {
      const selfLocations = locationsFromMask(selfMask!);
      const opponentLocations = locationsFromMask(opponentMask!);
      return (ctx, card) => {
        const opponent = card.controller === 0 ? 1 : 0;
        const count = ctx.duel.cards.filter((candidate) =>
          (candidate.controller === card.controller && selfLocations.includes(candidate.location)) ||
          (candidate.controller === opponent && opponentLocations.includes(candidate.location))
        ).length;
        return count <= lte! ? lteValue! : count >= gte! ? gteValue! : elseValue!;
      };
    }
  }
  const matchingFaceupRaceCount = luaValueDescriptor?.match(/^stat:matching-faceup-race-count:(controller|player[01]):(\d+):(\d+):(include-handler|exclude-handler):(\d+):x(-?\d+)$/);
  if (matchingFaceupRaceCount?.[1] && matchingFaceupRaceCount[2] && matchingFaceupRaceCount[3] && matchingFaceupRaceCount[4] && matchingFaceupRaceCount[5] && matchingFaceupRaceCount[6]) {
    const playerScope = matchingFaceupRaceCount[1];
    const selfMask = Number(matchingFaceupRaceCount[2]);
    const opponentMask = Number(matchingFaceupRaceCount[3]);
    const excludeHandler = matchingFaceupRaceCount[4] === "exclude-handler";
    const race = Number(matchingFaceupRaceCount[5]);
    const multiplier = Number(matchingFaceupRaceCount[6]);
    if ([selfMask, opponentMask, race, multiplier].every(Number.isSafeInteger)) {
      const selfLocations = locationsFromMask(selfMask);
      const opponentLocations = locationsFromMask(opponentMask);
      return (ctx, card) => {
        const player = playerScope === "controller" ? card.controller : Number(playerScope.slice("player".length));
        const opponent = player === 0 ? 1 : 0;
        return ctx.duel.cards.filter((candidate) => {
          if (!candidate.faceUp) return false;
          if (excludeHandler && candidate.uid === ctx.source.uid) return false;
          if ((currentRace(candidate, ctx.duel) & race) === 0) return false;
          return (candidate.controller === player && selfLocations.includes(candidate.location)) ||
            (candidate.controller === opponent && opponentLocations.includes(candidate.location));
        }).length * multiplier;
      };
    }
  }
  const matchingTypeSumLink = luaValueDescriptor?.match(/^stat:matching-type-sum-link:player([01]):(\d+):(\d+):(\d+):x(-?\d+)$/);
  if (matchingTypeSumLink?.[1] && matchingTypeSumLink[2] && matchingTypeSumLink[3] && matchingTypeSumLink[4] && matchingTypeSumLink[5]) {
    const player = Number(matchingTypeSumLink[1]);
    const selfMask = Number(matchingTypeSumLink[2]);
    const opponentMask = Number(matchingTypeSumLink[3]);
    const typeMask = Number(matchingTypeSumLink[4]);
    const multiplier = Number(matchingTypeSumLink[5]);
    if ([player, selfMask, opponentMask, typeMask, multiplier].every(Number.isSafeInteger)) {
      const selfLocations = locationsFromMask(selfMask);
      const opponentLocations = locationsFromMask(opponentMask);
      return (ctx) => {
        const opponent = player === 0 ? 1 : 0;
        return ctx.duel.cards
          .filter((candidate) => ((candidate.controller === player && selfLocations.includes(candidate.location)) || (candidate.controller === opponent && opponentLocations.includes(candidate.location))) && (cardTypeFlags(candidate, ctx.duel) & typeMask) !== 0)
          .reduce((total, candidate) => total + currentLink(candidate, ctx.duel), 0) * multiplier;
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

function hasSelfCodeFlag(ctx: Parameters<NonNullable<DuelEffectDefinition["statValue"]>>[0], card: Parameters<NonNullable<DuelEffectDefinition["statValue"]>>[1]): boolean {
  const code = Number(card.code);
  return Number.isSafeInteger(code) && ctx.duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === card.uid && flag.code === code);
}
