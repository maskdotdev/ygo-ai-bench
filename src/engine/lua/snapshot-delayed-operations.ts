import { changeDuelCardPosition, destroyDuelCard, moveDuelCardWithRedirects, sendDuelCardToGraveyard } from "#duel/core.js";
import { resetDuelCardEffects } from "#duel/effect-reset.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import { currentRace } from "#duel/card-stats.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaEffectGeminiStatus = 75;
const luaBattlePhaseEventCode = 0x1000 | 0x80;
const luaPhaseStandbyEventCode = 0x1000 | 0x2;
const luaPhaseEndEventCode = 0x1000 | 0x200;
const luaPhaseStandbyResetFlags = 0x40000000 | 0x2;
const luaResetsStandardPhaseStandbyFlags = 0x40000000 | 0x1fe0000 | 0x2;
const luaPhaseStandbyResetSelfTurnFlags = 0x40000000 | 0x10000000 | 0x2;
const luaPhaseStandbyResetOpponentTurnFlags = 0x40000000 | 0x20000000 | 0x2;
const luaPhaseEndResetFlags = 0x40000000 | 0x200;
const luaResetsStandardPhaseEndOpponentTurnFlags = 0x61fe0200;
const luaYellowAlertCode = "59277750";
const luaUnleashYourPowerCode = "73567374";
const luaTsumuhaKutsunagiCode = "78098950";
const luaEngraverOfTheMarkCode = "50078320";
const luaLimiterRemovalCode = "23171610";
const luaRagingMadPlantsCode = "95507060";
const luaPurushaddollAeonCode = "78942513";
const luaDangersOfTheDivineCode = "22082432";
const luaWakeCupMochaCode = "91818544";
const luaRbLambdaBladeCode = "17188206";

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
  return delayedFlaggedSendToHandOperation(effect);
}

export function isKnownDelayedSendToHandEffect(effect: SerializedDuelEffect): boolean {
  return (
    !effect.registryKey?.startsWith(`lua:${luaEngraverOfTheMarkCode}:`) &&
    !effect.registryKey?.startsWith(`lua:${luaPurushaddollAeonCode}:`) &&
    !effect.registryKey?.startsWith(`lua:${luaUnleashYourPowerCode}:`) &&
    !effect.registryKey?.startsWith(`lua:${luaTsumuhaKutsunagiCode}:`) &&
    !effect.registryKey?.startsWith(`lua:${luaWakeCupMochaCode}:`) &&
    !effect.registryKey?.startsWith("lua:324483:") &&
    effect.event === "continuous" &&
    (effect.code === luaBattlePhaseEventCode || effect.code === luaPhaseEndEventCode) &&
    effect.label !== undefined &&
    effect.labelObjectUid === undefined &&
    (effect.labelObjectUids?.length ?? 0) === 0 &&
    effect.targetRange === undefined &&
    temporaryBanishReturnCountLimitMatches(effect) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownWakeCupMochaDelayedSendToGraveEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaWakeCupMochaCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd" || effect.triggerEvent === "phaseStandby") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.label !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function wakeCupMochaDelayedSendToGraveOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const fieldId = effect.label;
    if (fieldId === undefined) return;
    const targetUids = ctx.duel.flagEffects.filter((flag) => flag.ownerType === "card" && flag.code === Number(luaWakeCupMochaCode) && flag.value === fieldId).map((flag) => flag.ownerId);
    for (const uid of [...new Set(targetUids)]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        sendDuelCardToGraveyard(ctx.duel, target.uid, target.controller, duelReason.effect, ctx.player, {
          eventReasonCardUid: ctx.source.uid,
          ...effectReasonIdPayload(effect),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer move.
      }
    }
  };
}

export function delayedFlaggedSendToHandOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const fieldId = effect.label;
    const flagCode = Number(ctx.source.code);
    if (fieldId === undefined || !Number.isSafeInteger(flagCode)) return;
    const targetUids = ctx.duel.flagEffects.filter((flag) => flag.ownerType === "card" && flag.code === flagCode && flag.value === fieldId).map((flag) => flag.ownerId);
    for (const uid of [...new Set(targetUids)]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, { eventReasonCardUid: ctx.source.uid, ...effectReasonIdPayload(effect) });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer move.
      }
    }
  };
}

export function isKnownDelayedGroupSendToHandEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaDangersOfTheDivineCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    (effect.labelObjectUids?.length ?? 0) > 0 &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function delayedGroupSendToHandOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    for (const uid of [...new Set(effect.labelObjectUids ?? [])]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, {
          eventReasonCardUid: effect.sourceUid,
          ...effectReasonIdPayload(effect),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer move.
      }
    }
  };
}

export function isKnownRbLambdaBladeDelayedDestroyEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaRbLambdaBladeCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    (effect.labelObjectUids?.length ?? 0) > 0 &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function rbLambdaBladeDelayedDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    for (const uid of [...new Set(effect.labelObjectUids ?? [])]) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
          ...effectReasonIdPayload(effect),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer be destroyed.
      }
    }
  };
}

function effectReasonIdPayload(effect: SerializedDuelEffect): { eventReasonEffectId: number } | Record<string, never> {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? { eventReasonEffectId: id } : {};
}

export function isKnownUnleashYourPowerDelayedSetEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaUnleashYourPowerCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
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
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownEngraverOfTheMarkDelayedDestroyEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaEngraverOfTheMarkCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    (effect.reset.count ?? 0) >= 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownLimiterRemovalDelayedDestroyEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaLimiterRemovalCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    (effect.labelObjectUids?.length ?? 0) > 0 &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function limiterRemovalDelayedDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    for (const uid of limiterRemovalDelayedDestroyTargetUids(ctx.duel, effect)) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
          ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer be destroyed.
      }
    }
  };
}

export function isKnownRagingMadPlantsDelayedDestroyEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaRagingMadPlantsCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function ragingMadPlantsDelayedDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const targetUids = ctx.duel.cards
      .filter((card) => card.controller === effect.controller && card.location === "monsterZone" && card.faceUp && (currentRace(card, ctx.duel) & 0x400) !== 0)
      .sort((left, right) => left.sequence - right.sequence || left.uid.localeCompare(right.uid))
      .map((card) => card.uid);
    for (const uid of targetUids) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
          ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer be destroyed.
      }
    }
  };
}

export function isKnownPurushaddollAeonDelayedFlipEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaPurushaddollAeonCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporaryBanishReturnToFieldEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === luaPhaseEndEventCode || effect.code === luaPhaseStandbyEventCode) &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode || effect.triggerCode === luaPhaseStandbyEventCode) &&
    effect.sourceUid !== undefined &&
    (effect.labelObjectUid !== undefined || (effect.labelObjectUids?.length ?? 0) > 0) &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    temporaryBanishReturnResetMatches(effect) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function temporaryBanishReturnToFieldCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> | undefined {
  if (effect.code === luaPhaseEndEventCode && effect.reset?.flags === luaResetsStandardPhaseEndOpponentTurnFlags) {
    return (ctx) => ctx.duel.turnPlayer !== effect.controller;
  }
  if (effect.code === luaPhaseStandbyEventCode && effect.reset?.flags === luaPhaseStandbyResetSelfTurnFlags) {
    return (ctx) => ctx.duel.turnPlayer === effect.controller;
  }
  if (effect.code === luaPhaseStandbyEventCode && effect.reset?.flags === luaPhaseStandbyResetOpponentTurnFlags) {
    return (ctx) => ctx.duel.turnPlayer !== effect.controller;
  }
  return undefined;
}

export function temporaryBanishReturnToFieldOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const targetUids = effect.labelObjectUid === undefined ? [...new Set(effect.labelObjectUids ?? [])] : [effect.labelObjectUid];
    for (const targetUid of targetUids) {
      const target = ctx.duel.cards.find((card) => card.uid === targetUid);
      const destination = target?.previousLocation === "monsterZone" || target?.previousLocation === "spellTrapZone" ? target.previousLocation : undefined;
      const controller = target?.previousController;
      if (!target || !destination || controller === undefined) continue;
      try {
        moveDuelCardWithRedirects(ctx.duel, target.uid, destination, controller, duelReason.effect, effect.controller, {
          eventReasonCardUid: effect.sourceUid,
          ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer return.
      }
    }
  };
}

function temporaryBanishReturnResetMatches(effect: SerializedDuelEffect): boolean {
  if (effect.code === luaPhaseStandbyEventCode) {
    return effect.reset?.flags === luaPhaseStandbyResetFlags ||
      effect.reset?.flags === luaResetsStandardPhaseStandbyFlags ||
      effect.reset?.flags === luaPhaseStandbyResetSelfTurnFlags ||
      effect.reset?.flags === luaPhaseStandbyResetOpponentTurnFlags;
  }
  return effect.reset?.flags === luaPhaseEndResetFlags || effect.reset?.flags === luaResetsStandardPhaseEndOpponentTurnFlags;
}

function temporaryBanishReturnCountLimitMatches(effect: SerializedDuelEffect): boolean {
  return effect.countLimit === 1 || (effect.countLimit === undefined && effect.code === luaPhaseEndEventCode && effect.reset?.flags === luaResetsStandardPhaseEndOpponentTurnFlags);
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

export function purushaddollAeonDelayedFlipOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const targetUid = purushaddollAeonDelayedFlipTargetUid(ctx.duel, effect);
    const target = targetUid === undefined ? undefined : ctx.duel.cards.find((card) => card.uid === targetUid);
    if (!target || !hasPurushaddollAeonFlag(ctx.duel, effect, target.uid)) return;
    try {
      changeDuelCardPosition(ctx.duel, target.controller, target.uid, "faceDownDefense", "effect", {
        eventReason: duelReason.effect,
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      } as Parameters<typeof changeDuelCardPosition>[5]);
    } catch {
      // EDOPro-style delayed operations ignore targets that are no longer position-change legal.
    }
  };
}

export function purushaddollAeonDelayedFlipCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    const targetUid = purushaddollAeonDelayedFlipTargetUid(ctx.duel, effect);
    const target = targetUid === undefined ? undefined : ctx.duel.cards.find((card) => card.uid === targetUid);
    return Boolean(target && hasPurushaddollAeonFlag(ctx.duel, effect, target.uid));
  };
}

export function engraverOfTheMarkDelayedDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    for (const uid of engraverOfTheMarkDelayedDestroyTargetUids(ctx.duel, effect)) {
      const target = ctx.duel.cards.find((card) => card.uid === uid);
      if (!target) continue;
      try {
        destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
          ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        });
      } catch {
        // EDOPro-style delayed operations ignore targets that can no longer be destroyed.
      }
    }
  };
}

export function engraverOfTheMarkDelayedDestroyCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    const matchingFlags = ctx.duel.flagEffects.filter((flag) => flag.ownerType === "card" && flag.code === Number(luaEngraverOfTheMarkCode) && flag.value === effect.label);
    if (matchingFlags.length > 0) {
      return matchingFlags.some((flag) => flag.turn !== undefined && ctx.duel.turn === flag.turn + 1) && engraverOfTheMarkDelayedDestroyTargetUids(ctx.duel, effect).length > 0;
    }
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    return source?.turnId !== undefined && ctx.duel.turn === source.turnId + 1 && engraverOfTheMarkDelayedDestroyTargetUids(ctx.duel, effect).length > 0;
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

function engraverOfTheMarkDelayedDestroyTargetUids(duel: Parameters<NonNullable<DuelEffectDefinition["operation"]>>[0]["duel"], effect: SerializedDuelEffect): string[] {
  const fieldId = effect.label;
  if (fieldId === undefined) return [];
  const targetUids = duel.flagEffects
    .filter((flag) => flag.ownerType === "card" && flag.code === Number(luaEngraverOfTheMarkCode) && flag.value === fieldId)
    .map((flag) => flag.ownerId);
  const fallbackUid = effect.sourceUid === undefined || targetUids.length > 0 ? [] : [effect.sourceUid];
  return [...new Set([...targetUids, ...fallbackUid])].filter((uid) => duel.cards.some((card) => card.uid === uid && (card.location === "monsterZone" || card.location === "spellTrapZone")));
}

function limiterRemovalDelayedDestroyTargetUids(duel: Parameters<NonNullable<DuelEffectDefinition["operation"]>>[0]["duel"], effect: SerializedDuelEffect): string[] {
  const fieldId = effect.label;
  if (fieldId === undefined) return [];
  const flagged = duel.flagEffects
    .filter((flag) => flag.ownerType === "card" && flag.code === Number(luaLimiterRemovalCode) && flag.value === fieldId)
    .map((flag) => flag.ownerId);
  const fallback = effect.labelObjectUids ?? [];
  return [...new Set([...flagged, ...fallback])].filter((uid) => duel.cards.some((card) => card.uid === uid && card.location === "monsterZone"));
}

function hasPurushaddollAeonFlag(duel: Parameters<NonNullable<DuelEffectDefinition["operation"]>>[0]["duel"], effect: SerializedDuelEffect, ownerId: string): boolean {
  return duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === ownerId && flag.code === Number(luaPurushaddollAeonCode) && flag.value === effect.label);
}

function purushaddollAeonDelayedFlipTargetUid(duel: Parameters<NonNullable<DuelEffectDefinition["operation"]>>[0]["duel"], effect: SerializedDuelEffect): string | undefined {
  const flagged = duel.flagEffects.find((flag) => flag.ownerType === "card" && flag.code === Number(luaPurushaddollAeonCode) && flag.value === effect.label);
  if (flagged?.ownerId !== undefined) return flagged.ownerId;
  return effect.labelObjectUid;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
