import { fallbackCardReader } from "#duel/card-reader.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { cardTypeFlags } from "#duel/card-stats.js";
import { applyResponse, getGroupedDuelLegalActions, getLegalActions, moveDuelCardWithRedirects, queryPublicState } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { cardFieldId } from "#duel/card-field-id.js";
import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { luaTemporaryControlReturnDescriptor, luaTemporaryControlReturnOperation } from "#lua/duel-api/move-control.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, ChainLimit, DuelAction, DuelCardReader, DuelEffectDefinition, DuelResponse, DuelSession, PlayerId, SerializedDuel, SerializedDuelEffect } from "#duel/types.js";

const luaEffectEquipLimit = 76;
const luaEffectUnionStatus = 347;
const luaEffectOldUnionStatus = 348;
const luaEffectClockLizard = 51476410;
const luaEffectIndestructibleEffect = 41;
const luaEffectIndestructibleBattle = 42;
const luaEffectFlagClientHint = 0x4000000;
const luaUnionStateEffectCodes = new Set([luaEffectEquipLimit, luaEffectUnionStatus, luaEffectOldUnionStatus]);
const luaStaticSingleCardRestrictionCodes = new Set([43, 44, 85]);
const luaIndestructibleValueDescriptors = new Set(["indestructible:opponent", "indestructible:self"]);
const luaLifePointReasonPredicateEffectCodes = new Set([80, 81]);
const luaEffectReasonPredicateDescriptor = "value-predicate:effect-reason";
const luaReasonMaskPredicateDescriptorPrefix = "value-predicate:reason-mask:";
const luaValueCardNotHandlerDescriptor = "value-card:not-handler";
const luaCannotActivateSpecialSummonedMonsterDescriptor = "cannot-activate:special-summoned-monster-on-field";
const luaSourceControllerConditionDescriptor = "condition:source-controller";
const luaYellowAlertCode = "59277750";
const luaResetEvent = 0x1000;
const luaResetTurnSet = 0x20000;
const luaResetPhase = 0x40000000;
const luaPhaseBattle = 0x80;
const luaPhaseEnd = 0x200;
const luaBattlePhaseEventCode = luaResetEvent | luaPhaseBattle;
const luaPhaseEndResetFlags = luaResetPhase | luaPhaseEnd;
const luaResetsStandardPhaseEnd = 0x41fe1200;
const luaResetEventStandard = luaResetEvent | 0x1fe0000;
const luaTemporaryRestrictionResetFlags = luaResetsStandardPhaseEnd & ~luaResetTurnSet;
const luaTemporaryPositionLockResetFlags = luaResetPhase | luaPhaseEnd;
const luaStaticPlayerPhaseLockCodes = new Set([183, 184, 185, 186, 187, 189]);

export interface LuaSnapshotRestoreResult {
  session: DuelSession;
  host: LuaScriptHost;
  restoreComplete: boolean;
  loadedScripts: LuaScriptLoadResult[];
  registeredEffects: number;
  restoredRegistryKeys: string[];
  missingRegistryKeys: string[];
  chainLimitRegistryKeys: string[];
  missingChainLimitRegistryKeys: string[];
  incompleteReasons: string[];
}

export function restoreDuelWithLuaScripts(
  snapshot: SerializedDuel,
  source: LuaScriptSource,
  cardReader: DuelCardReader = fallbackCardReader,
): LuaSnapshotRestoreResult {
  const chainLimitRegistryKeys = luaChainLimitRegistryKeys(snapshot);
  const session = restoreDuel(snapshot, cardReader, {}, luaDenyChainLimitRegistry(chainLimitRegistryKeys), { pruneUnrestoredPendingTriggers: false });
  session.state.actionWindowToken = createActionWindowToken();
  const host = createLuaScriptHost(session);
  const registryKeys = luaRegistryKeys(snapshot);
  const scriptRegistryKeys = luaScriptRegistryKeys(registryKeys, snapshot.state.effects);
  const loadedScripts = [...luaRegistryCardCodes(scriptRegistryKeys, chainLimitRegistryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  const restoredStateScripts = loadedScripts.every((result) => result.ok) ? restoreKnownLuaStateEffects(session, host, registryKeys, snapshot.state.effects) : [];
  restoreKnownLuaChainLimits(session, host, chainLimitRegistryKeys);
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys, snapshot.state.effects);
  restoredRegistryKeys.push(...restoreKnownLuaEffects(session, registryKeys, snapshot.state.effects, restoredRegistryKeys));
  prunePendingTriggersWithoutEffects(session.state);
  const missingRegistryKeys = [...registryKeys].filter((key) => !restoredRegistryKeys.includes(key));
  const restoredChainLimitRegistryKeys = luaChainLimitRegistryKeys({ ...snapshot, state: session.state });
  const missingChainLimitRegistryKeys = chainLimitRegistryKeys.filter((key) => !restoredChainLimitRegistryKeys.includes(key));
  const incompleteReasons = luaRestoreIncompleteReasons([...loadedScripts, ...restoredStateScripts], missingRegistryKeys, missingChainLimitRegistryKeys);
  const restoreComplete = incompleteReasons.length === 0;
  return { session, host, restoreComplete, loadedScripts: [...loadedScripts, ...restoredStateScripts], registeredEffects, restoredRegistryKeys, missingRegistryKeys, chainLimitRegistryKeys, missingChainLimitRegistryKeys, incompleteReasons };
}

export function getLuaRestoreLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): DuelAction[] {
  if (!restored.restoreComplete) return [];
  return getLegalActions(restored.session, player);
}

export function getLuaRestoreLegalActionGroups(restored: LuaSnapshotRestoreResult, player: PlayerId): DuelLegalActionGroup[] {
  if (!restored.restoreComplete) return [];
  return getGroupedDuelLegalActions(restored.session, player);
}

export function applyLuaRestoreResponse(restored: LuaSnapshotRestoreResult, response: DuelResponse): ApplyDuelResponseResult {
  if (!restored.restoreComplete) {
    return {
      ok: false,
      error: luaRestoreIncompleteError(restored),
      state: queryPublicState(restored.session),
      legalActions: [],
      legalActionGroups: [],
    };
  }
  return applyResponse(restored.session, response);
}

function filterRestoredLuaEffects(session: DuelSession, registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): string[] {
  if (registryKeys.size === 0) return [];
  const snapshotEffectsByKey = new Map(snapshotEffects.map((effect) => [effect.registryKey, effect]).filter((entry): entry is [string, SerializedDuelEffect] => Boolean(entry[0])));
  const semanticSnapshotEffectsByLiveKey = new Map<string, SerializedDuelEffect>();
  const semanticRegistryKeys = new Set<string>();
  session.state.effects = session.state.effects
    .filter((effect) => {
      if (effect.registryKey === undefined || registryKeys.has(effect.registryKey)) return true;
      const snapshotEffect = findRestoredLuaStateSnapshotEffect(session, effect, registryKeys, snapshotEffects, semanticRegistryKeys);
      if (!snapshotEffect) return false;
      semanticSnapshotEffectsByLiveKey.set(effect.registryKey, snapshotEffect);
      semanticRegistryKeys.add(snapshotEffect.registryKey!);
      return true;
    })
    .map((effect) => mergeRestoredLuaEffectMetadata(effect, snapshotEffectsByKey.get(effect.registryKey ?? "") ?? semanticSnapshotEffectsByLiveKey.get(effect.registryKey ?? "")));
  const exactRegistryKeys = session.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:") && registryKeys.has(key)));
  return [...new Set([...exactRegistryKeys, ...semanticRegistryKeys])];
}

function mergeRestoredLuaEffectMetadata(effect: DuelEffectDefinition, snapshotEffect: SerializedDuelEffect | undefined): DuelEffectDefinition {
  if (snapshotEffect?.reset === undefined) return effect;
  return { ...effect, reset: { ...snapshotEffect.reset } };
}

function findRestoredLuaStateSnapshotEffect(
  session: DuelSession,
  effect: DuelEffectDefinition,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: Set<string>,
): SerializedDuelEffect | undefined {
  if (!isKnownLuaUnionStateEffect(session, effect)) return undefined;
  return snapshotEffects.find((snapshotEffect) => {
    if (!snapshotEffect.registryKey || !registryKeys.has(snapshotEffect.registryKey) || restoredRegistryKeys.has(snapshotEffect.registryKey)) return false;
    return snapshotEffect.sourceUid === effect.sourceUid && snapshotEffect.event === effect.event && snapshotEffect.code === effect.code && isKnownLuaUnionStateEffect(session, snapshotEffect);
  });
}

function isKnownLuaUnionStateEffect(session: DuelSession, effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  if (effect.event !== "continuous" || effect.code === undefined || !luaUnionStateEffectCodes.has(effect.code)) return false;
  const source = session.state.cards.find((card) => card.uid === effect.sourceUid);
  return Boolean(source && source.location === "spellTrapZone" && source.equippedToUid !== undefined);
}

function restoreKnownLuaStateEffects(
  session: DuelSession,
  host: LuaScriptHost,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
): LuaScriptLoadResult[] {
  const unionStateSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && (effect.code === luaEffectUnionStatus || effect.code === luaEffectOldUnionStatus))
      .map((effect) => effect.sourceUid),
  );
  const equipLimitSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && effect.code === luaEffectEquipLimit && !unionStateSourceUids.has(effect.sourceUid))
      .map((effect) => effect.sourceUid),
  );
  const results: LuaScriptLoadResult[] = [];
  for (const sourceUid of unionStateSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "spellTrapZone" || card.equippedToUid === undefined) continue;
    const script = `
      local c=Duel.GetFieldCard(${card.controller},LOCATION_SZONE,${card.sequence})
      if c and c:IsFieldID(${cardFieldId(card)}) then
        aux.SetUnionState(c)
      end
    `;
    results.push(host.loadScript(script, `restore-union-state-${card.uid}.lua`));
  }
  for (const sourceUid of equipLimitSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "spellTrapZone" || card.equippedToUid === undefined) continue;
    const script = `
      local c=Duel.GetFieldCard(${card.controller},LOCATION_SZONE,${card.sequence})
      if c and c:IsFieldID(${cardFieldId(card)}) then
        local tc=c:GetFirstCardTarget() or c:GetEquipTarget()
        if tc then
          local e1=Effect.CreateEffect(c)
          e1:SetType(EFFECT_TYPE_SINGLE)
          e1:SetCode(EFFECT_EQUIP_LIMIT)
          e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
          e1:SetReset(RESET_EVENT|RESETS_STANDARD)
          e1:SetValue(function(e,ec) return e:GetLabelObject()==ec end)
          e1:SetLabelObject(tc)
          c:RegisterEffect(e1)
        end
      end
    `;
    results.push(host.loadScript(script, `restore-equip-limit-${card.uid}.lua`));
  }
  return results;
}

function restoreKnownLuaEffects(
  session: DuelSession,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: string[],
): string[] {
  const restored = new Set(restoredRegistryKeys);
  const added: string[] = [];
  for (const effect of snapshotEffects) {
    if (!effect.registryKey || !registryKeys.has(effect.registryKey) || restored.has(effect.registryKey)) continue;
    if (!isKnownRestorableLuaEffect(effect)) continue;
    session.state.effects.push({
      ...effect,
      range: [...effect.range],
      ...(effect.reset ? { reset: { ...effect.reset } } : {}),
      ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
      ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
      ...restoredLuaValueCallbacks(effect),
      ...restoredLuaConditionCallbacks(effect),
      ...restoredLuaTargetCallbacks(effect),
      operation: restoredLuaOperation(effect),
    });
    added.push(effect.registryKey);
  }
  return added;
}

function isKnownRestorableLuaEffect(effect: SerializedDuelEffect): boolean {
  return (
    isClientHintEffect(effect) ||
    (effect.event === "continuous" &&
      (effect.code === 2 ||
        effect.code === 8 ||
        effect.code === 22 ||
        isStaticNotSetcodeSummonRestriction(effect) ||
        effect.code === 25 ||
        effect.code === luaEffectClockLizard ||
        (effect.code === 71 && effect.luaValueDescriptor === "cannot-be-effect-target:opponent") ||
        isKnownIndestructibleValueEffect(effect) ||
        effect.luaValueDescriptor === "change-damage:effect-double" ||
        effect.luaValueDescriptor === "reflect-damage:opponent-non-continuous" ||
        isKnownLifePointReasonPredicateEffect(effect) ||
        isKnownIndestructibleCountReasonPredicateEffect(effect) ||
        isKnownCannotSelectBattleTargetNotHandlerEffect(effect) ||
        isKnownYellowAlertDelayedReturnEffect(effect) ||
        isKnownCannotActivateSpecialSummonedMonsterEffect(effect) ||
        effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor ||
        isStaticSingleCardLuaRestriction(effect) ||
        isStaticPlayerPhaseLock(effect) ||
        (effect.code === 102 && effect.value !== undefined && effect.value !== 0 && effect.targetRange === undefined) ||
        ((effect.code === 100 || effect.code === 103 || effect.code === 104 || effect.code === 107 || effect.code === 130 || effect.code === 132) && effect.value !== undefined)))
  );
}

function isKnownCannotActivateSpecialSummonedMonsterEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.luaValueDescriptor === luaCannotActivateSpecialSummonedMonsterDescriptor &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 0 &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownYellowAlertDelayedReturnEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaYellowAlertCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaBattlePhaseEventCode &&
    effect.label !== undefined &&
    effect.targetRange === undefined
  );
}

function isKnownCannotSelectBattleTargetNotHandlerEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 332 &&
    effect.luaValueDescriptor === luaValueCardNotHandlerDescriptor &&
    effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange?.[0] === 0 &&
    effect.targetRange?.[1] === 0x04
  );
}

function isKnownLifePointReasonPredicateEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.code !== undefined &&
    luaLifePointReasonPredicateEffectCodes.has(effect.code) &&
    luaReasonPredicateMask(effect.luaValueDescriptor) === duelReason.effect &&
    effect.reset !== undefined &&
    effect.targetRange !== undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownIndestructibleCountReasonPredicateEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 47 &&
    luaReasonPredicateMask(effect.luaValueDescriptor) !== undefined &&
    effect.reset !== undefined &&
    effect.targetRange === undefined &&
    effect.luaTargetDescriptor === undefined
  );
}

function isKnownIndestructibleValueEffect(effect: SerializedDuelEffect): boolean {
  return (
    (effect.code === luaEffectIndestructibleEffect || effect.code === luaEffectIndestructibleBattle) &&
    effect.luaValueDescriptor !== undefined &&
    luaIndestructibleValueDescriptors.has(effect.luaValueDescriptor) &&
    effect.reset !== undefined &&
    (effect.targetRange === undefined || hasDefaultLuaFieldRange(effect))
  );
}

function isStaticNotSetcodeSummonRestriction(effect: SerializedDuelEffect): boolean {
  return (effect.code === 20 || effect.code === 22) && notSetcodeTargetDescriptor(effect.luaTargetDescriptor) !== undefined;
}

function isClientHintEffect(effect: SerializedDuelEffect): boolean {
  return effect.code === undefined && ((effect.property ?? 0) & luaEffectFlagClientHint) !== 0;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}

function isStaticSingleCardLuaRestriction(effect: SerializedDuelEffect): boolean {
  if (effect.targetRange !== undefined || effect.sourceUid === undefined || effect.range.length !== 1) return false;
  if (effect.code === 14) return effect.reset?.flags === luaTemporaryPositionLockResetFlags;
  return effect.code !== undefined && luaStaticSingleCardRestrictionCodes.has(effect.code) && isTemporaryRestrictionReset(effect.reset?.flags);
}

function isTemporaryRestrictionReset(flags: number | undefined): boolean {
  return flags === luaTemporaryRestrictionResetFlags || flags === luaResetsStandardPhaseEnd;
}

function isStaticPlayerPhaseLock(effect: SerializedDuelEffect): boolean {
  return (
    effect.code !== undefined &&
    luaStaticPlayerPhaseLockCodes.has(effect.code) &&
    effect.targetRange !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined
  );
}

function restoredLuaOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  if (isKnownYellowAlertDelayedReturnEffect(effect)) return yellowAlertDelayedReturnOperation(effect);
  if (effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor) {
    const returnPlayer = effect.value === 0 || effect.value === 1 ? effect.value : undefined;
    return luaTemporaryControlReturnOperation(returnPlayer);
  }
  return () => {};
}

function yellowAlertDelayedReturnOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
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

function restoredLuaValueCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "battleDamageValue" | "lifePointValue" | "valueCardPredicate" | "valuePredicate"> {
  if (effect.luaValueDescriptor === "cannot-be-effect-target:opponent") {
    return { valuePredicate: (_ctx, player) => player !== undefined && player !== effect.controller };
  }
  if (effect.luaValueDescriptor === "indestructible:opponent") {
    return { valuePredicate: (_ctx, player) => player !== undefined && player !== effect.controller };
  }
  if (effect.luaValueDescriptor === "indestructible:self") {
    return { valuePredicate: (_ctx, player) => player !== undefined && player === effect.controller };
  }
  if (effect.luaValueDescriptor === "reflect-damage:opponent-non-continuous") {
    return { valuePredicate: (ctx) => ctx.eventReasonPlayer === otherPlayer(effect.controller) && !relatedEffectIsContinuous(ctx) };
  }
  const reasonMask = luaReasonPredicateMask(effect.luaValueDescriptor);
  if (reasonMask !== undefined) {
    return { valuePredicate: (ctx) => ((ctx.eventReason ?? 0) & reasonMask) !== 0 };
  }
  if (effect.luaValueDescriptor === luaValueCardNotHandlerDescriptor) {
    return { valueCardPredicate: (_ctx, card) => card.uid !== effect.sourceUid };
  }
  if (effect.luaValueDescriptor === luaCannotActivateSpecialSummonedMonsterDescriptor) {
    return { valuePredicate: (ctx) => relatedEffectIsSpecialSummonedMonsterOnField(ctx) };
  }
  if (effect.luaValueDescriptor !== "change-damage:effect-double") return {};
  const applyValue = (ctx: Parameters<NonNullable<DuelEffectDefinition["lifePointValue"]>>[0], _player: PlayerId, amount: number): number =>
    ((ctx.eventReason ?? 0) & duelReason.effect) !== 0 ? amount * 2 : amount;
  return { battleDamageValue: applyValue, lifePointValue: applyValue };
}

function restoredLuaConditionCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "canActivate"> {
  if (effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor) {
    return { canActivate: (ctx) => ctx.source.controller === effect.controller };
  }
  return {};
}

function luaReasonPredicateMask(descriptor: string | undefined): number | undefined {
  if (descriptor === luaEffectReasonPredicateDescriptor) return duelReason.effect;
  if (!descriptor?.startsWith(luaReasonMaskPredicateDescriptorPrefix)) return undefined;
  const mask = Number(descriptor.slice(luaReasonMaskPredicateDescriptorPrefix.length));
  return Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function restoredLuaTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "targetCardPredicate"> {
  if (effect.luaTargetDescriptor === "special-summon-limit:non-fusion-extra") {
    return { targetCardPredicate: (_ctx, card) => card.location === "extraDeck" && ((card.data.typeFlags ?? 0) & 0x40) === 0 };
  }
  const notSetcode = notSetcodeTargetDescriptor(effect.luaTargetDescriptor);
  if (notSetcode !== undefined) return { targetCardPredicate: (_ctx, card) => !cardSetcodes(card).some((setcode) => isSetcodeMatch(notSetcode, setcode)) };
  return {};
}

function notSetcodeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const match = descriptor?.match(/^target:not-setcode:(\d+)$/);
  const setcode = match?.[1] ? Number(match[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

function relatedEffectIsContinuous(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): boolean {
  const relatedEffectId = ctx.relatedEffectId === undefined ? ctx.chainLink?.effectId : `lua-${ctx.relatedEffectId}`;
  const relatedEffect = ctx.duel.effects.find((effect) => effect.id === relatedEffectId);
  return ((relatedEffect?.luaTypeFlags ?? 0) & 0x800) !== 0;
}

function relatedEffectIsSpecialSummonedMonsterOnField(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): boolean {
  const relatedEffectId = ctx.relatedEffectId === undefined ? ctx.chainLink?.effectId : `lua-${ctx.relatedEffectId}`;
  const relatedEffect = ctx.duel.effects.find((effect) => effect.id === relatedEffectId);
  const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
  return Boolean(
    handler &&
      (cardTypeFlags(handler, ctx.duel) & 0x1) !== 0 &&
      handler.location === "monsterZone" &&
      handler.summonType !== undefined &&
      handler.summonType !== "normal" &&
      handler.summonType !== "tribute" &&
      handler.summonType !== "flip",
  );
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function luaScriptRegistryKeys(registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): Set<string> {
  const knownRestorableKeys = new Set(
    snapshotEffects
      .filter(isKnownRestorableLuaEffect)
      .map((effect) => effect.registryKey)
      .filter((key): key is string => Boolean(key)),
  );
  return new Set([...registryKeys].filter((key) => !knownRestorableKeys.has(key)));
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> {
  return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:"))));
}

function luaChainLimitRegistryKeys(snapshot: SerializedDuel): string[] {
  return snapshot.state.chainLimits.map((limit) => limit.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua-chain-limit:")));
}

function luaDenyChainLimitRegistry(keys: string[]): Record<string, (limit: ChainLimit) => ChainLimit> {
  return Object.fromEntries(keys.map((key) => [key, knownLuaChainLimitRestoreFactory(key) ?? ((limit: ChainLimit): ChainLimit => {
    const { registryKey: _registryKey, ...metadata } = limit;
    return { ...metadata, allows: () => false };
  })]));
}

function knownLuaChainLimitRestoreFactory(key: string): ((limit: ChainLimit) => ChainLimit) | undefined {
  const parts = key.split(":");
  const knownPredicate = parts[4] === "known" ? parts.slice(5).join(":") : undefined;
  if (knownPredicate === "aux.FALSE") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "aux.TRUE") return (limit) => ({ ...limit, allows: () => true });
  if (knownPredicate?.startsWith("closure:card-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:card-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:target-cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:original-type-mask-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:type-mask-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-unless-chain-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type-setcode:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-code:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-codes:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-code-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-codes-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-effect-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:not-monster-without-level") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:not-active-monster-link") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:active-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:source-type-non-activate-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:spell-trap-non-activate-response-player") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^closure:response-player:[01]$/)) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:response-matches-chain-player") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^closure:chain-player:[01]$/)) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:source:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^c\d+\.[A-Za-z_]\w*$/)) return (limit) => ({ ...limit, allows: () => false });
  return undefined;
}

function restoreKnownLuaChainLimits(session: DuelSession, host: LuaScriptHost, keys: string[]): void {
  if (keys.length === 0) return;
  const keySet = new Set(keys);
  session.state.chainLimits = session.state.chainLimits.map((limit) => {
    if (!limit.registryKey || !keySet.has(limit.registryKey)) return limit;
    const restored = host.restoreChainLimit(limit.registryKey, limit);
    if (restored) return restored;
    const { registryKey: _registryKey, ...metadata } = limit;
    return { ...metadata, allows: () => false };
  });
}

function luaRestoreIncompleteReasons(loadedScripts: LuaScriptLoadResult[], missingRegistryKeys: string[], missingChainLimitRegistryKeys: string[]): string[] {
  return [
    ...loadedScripts.filter((result) => !result.ok).map((result) => `script ${result.name}: ${result.error}`),
    ...(missingRegistryKeys.length === 0 ? [] : [`missing Lua effect registry keys: ${missingRegistryKeys.join(", ")}`]),
    ...(missingChainLimitRegistryKeys.length === 0 ? [] : [`missing Lua chain-limit registry keys: ${missingChainLimitRegistryKeys.join(", ")}`]),
  ];
}

function luaRestoreIncompleteError(restored: LuaSnapshotRestoreResult): string {
  return restored.incompleteReasons.length === 0 ? "Lua snapshot restore is incomplete" : `Lua snapshot restore is incomplete: ${restored.incompleteReasons.join("; ")}`;
}

function luaRegistryCardCodes(registryKeys: Set<string>, chainLimitRegistryKeys: string[] = []): Set<string> {
  const codes = new Set<string>();
  for (const key of [...registryKeys, ...chainLimitRegistryKeys]) {
    const [, code] = key.split(":");
    if (code && /^\d+$/.test(code)) codes.add(code);
  }
  return codes;
}
