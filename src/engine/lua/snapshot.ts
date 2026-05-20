import { findCard, hasZoneSpace } from "#duel/card-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentRace } from "#duel/card-stats.js";
import { addDuelChainLimit, applyResponse, banishDuelCard, canMoveDuelCardToLocation, canPlayerSpecialSummon, collectDuelGroupedTriggerEffects, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, moveDuelCardWithRedirects, queryPublicState } from "#duel/core.js"; import { isControlChangePrevented } from "#duel/continuous-effects.js"; import { currentBattleStep } from "#duel/battle-window-state.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import { effectiveSpecialSummonTypeCode, isSummonTypeMaskMatch, luaSummonTypeRitual, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { cardFieldId } from "#duel/card-field-id.js";
import { bookOfEclipsePhaseEndCanActivate, bookOfEclipsePhaseEndOperation, isKnownBookOfEclipsePhaseEndEffect } from "#lua/snapshot-book-of-eclipse.js";
import { engraverOfTheMarkDelayedDestroyCanActivate, engraverOfTheMarkDelayedDestroyOperation, isKnownEngraverOfTheMarkDelayedDestroyEffect, isKnownTsumuhaKutsunagiDelayedShuffleEffect, isKnownUnleashYourPowerDelayedSetEffect, isKnownYellowAlertDelayedReturnEffect, tsumuhaKutsunagiDelayedShuffleOperation, unleashYourPowerDelayedSetOperation, yellowAlertDelayedReturnOperation } from "#lua/snapshot-delayed-operations.js";
import { luaHandlerDestroyOperation, luaLinkedLeaveFieldDestroyOperation } from "#lua/snapshot-destroy-operations.js";
import { isKnownLevelNormalEndPhaseDestroyEffect, levelNormalEndPhaseDestroyCanActivate, levelNormalEndPhaseDestroyOperation } from "#lua/snapshot-level-normal-end-phase-destroy.js";
import { isKnownSelfEndPhaseDestroyEffect, isKnownSelfEndPhaseSendEffect, selfEndPhaseDestroyOperation, selfEndPhaseSendOperation } from "#lua/snapshot-self-end-phase-destroy.js";
import { isKnownSwordsOfRevealingLightPhaseEndEffect, isKnownSwordsOfRevealingLightResetEffect, swordsOfRevealingLightPhaseEndCanActivate, swordsOfRevealingLightPhaseEndOperation, swordsOfRevealingLightRestoredReset } from "#lua/snapshot-swords-of-revealing-light.js";
import { isKnownPlayerDamageZeroEffect, isKnownStaticForbiddenCardEffect, isKnownTemporaryActivationLockEffect, isKnownTemporaryArtifactLanceaBanishLockEffect, isKnownTemporaryAttackAnnounceNegateEffect, isKnownTemporaryBattleProtectionEffect, isKnownTemporaryCannotAttackAnnounceSelfEffect, isKnownTemporaryCannotAttackEffect, isKnownTemporaryDirectAttackEffect, isKnownTemporaryEarthshatteringDeckGraveLockEffect, isKnownTemporaryForbiddenCardEffect, isKnownTemporaryMonsterExtraAttackEffect, isKnownTemporaryMonsterNoBattleDamageEffect, isKnownTemporaryOpponentCannotBattlePhaseEffect, isKnownTemporaryOpponentTurnSkipMain1Effect, isKnownTemporaryOpponentTurnSkipMain2Effect, isKnownTemporaryOpponentTurnSkipTurnEffect, isKnownTemporaryPlayerAttackAnnounceLockEffect, isKnownTemporaryPlayerHalfBattleDamageEffect, isKnownTemporarySameCodeActivationOathEffect, isKnownTemporarySelfTurnCannotEndPhaseEffect, isKnownTemporarySelfTurnSkipBattlePhaseEffect, isKnownTemporarySummonSetLockEffect, temporaryAttackAnnounceNegateOperation, temporaryOpponentTurnSkipMain1CanActivate, temporarySelfTurnSkipBattlePhaseCanActivate } from "#lua/snapshot-temporary-effects.js";
import { isKnownMulcharmyDrawWatcherEffect, isKnownMulcharmyEndPhaseShuffleEffect, mulcharmyDrawWatcherOperation, mulcharmyEndPhaseShuffleOperation } from "#lua/snapshot-mulcharmy.js";
import { assaultZoneExtraDeckReleaseValueCallbacks, assaultZoneReleaseFlagConditionCallbacks, assaultZoneReleaseFlagOperation, isAssaultZoneExtraDeckReleaseRestoreEffect } from "#lua/snapshot-assault-zone.js";
import { calledByTheGraveChainSolvingNegateOperation, gishkiEmiliaTrapNegateOperation, isKnownCalledByTheGraveChainSolvingNegateEffect, isKnownGishkiEmiliaTrapNegateEffect, isKnownRareMetalmorphChainSolvingNegateEffect, isKnownSameOriginalCodeChainSolvingNegateEffect, rareMetalmorphChainSolvingNegateOperation } from "#lua/snapshot-chain-solving-effects.js";
import { luaChainLimitRegistryKeys, luaDenyChainLimitRegistry, restoreKnownLuaChainLimits } from "#lua/snapshot-chain-limits.js";
import { isKnownSunlitSentinelDelayedStandbyEffect, sunlitSentinelDelayedStandbyOperation } from "#lua/snapshot-sunlit-sentinel.js";
import { isKnownDoubleSnareValidityEffect, isKnownTrapMonsterDisableEffect, isStaticPlayerPhaseLock } from "#lua/snapshot-static-effects.js";
import { isKnownCannotActivateLocationMonsterEffect, isKnownCannotActivateNonSpiritMonsterEffect, isKnownCannotActivateSpecialSummonedMonsterEffect, isKnownCannotBeMaterialEffect, isKnownCannotSelectBattleTargetNotHandlerEffect, isKnownGeminiEndPhaseReturnEffect, isKnownGeminiStatusEffect, isKnownGrantedSpiritEndPhaseReturnEffect, isKnownRemainFieldEffect, isKnownSetcodeOrCodeTypeBattleProtectionEffect, isKnownSpiritAddTypeEffect, isKnownTemporaryTunerAddTypeEffect } from "#lua/snapshot-restorable-effect-predicates.js";
import { isKnownXyzMaterialAttackGainTriggerEffect, isKnownXyzMaterialEffectAddType, xyzMaterialAttackGainOperation } from "#lua/snapshot-xyz-material-gain.js";
import { luaRegistryCardCodes } from "#lua/snapshot-registry-keys.js";
import { restoredSpecialSummonConditionValueCallbacks } from "#lua/snapshot-special-summon-condition.js";
import { isLuaOptionPromptDecision, isLuaYesNoPromptDecision } from "#lua/host-types.js";
import { ritualSummonSelectedMaterials, type LuaDuelSummonApiHostState } from "#lua/duel-api/summon.js";
import { luaTemporaryControlReturnDescriptor, luaTemporaryControlReturnOperation } from "#lua/duel-api/move-control.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import { specialSummonTypeIsCostDescriptor, specialSummonTypeNotCostDescriptor } from "#lua/effect-cost-descriptor.js";
import { luaValueDescriptorStatValue } from "#lua/effect-value-descriptor-callbacks.js";
import { locationMatchesCardMask, positionMaskFromPosition } from "#lua/api-utils.js"; import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { notSetcodeTargetDescriptor, restoredLuaTargetCallbacks, setcodeOrCodeTypeTargetDescriptor, setcodeTargetDescriptor, typeTargetDescriptor } from "#lua/snapshot-target-callbacks.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, ChainLink, DuelAction, DuelCardInstance, DuelCardReader, DuelEffectContext, DuelEffectDefinition, DuelResponse, DuelSession, PlayerId, SerializedDuel, SerializedDuelEffect } from "#duel/types.js";
const luaEffectEquipLimit = 76;
const luaEffectGeminiStatus = 75;
const luaEffectAddType = 115;
const luaEffectRemainField = 17;
const luaEffectUnionStatus = 347;
const luaEffectOldUnionStatus = 348;
const luaEffectClockLizard = 51476410;
const luaEffectPierce = 203;
const luaEffectIndestructibleEffect = 41;
const luaEffectIndestructibleBattle = 42;
const luaEffectForceMonsterZone = 265;
const luaEffectFlagClientHint = 0x4000000;
const luaEffectFlagPlayerTarget = 0x800;
const luaEventAdjust = 1040;
const luaUnionStateEffectCodes = new Set([luaEffectEquipLimit, luaEffectUnionStatus, luaEffectOldUnionStatus]);
const luaEquipLeaveFieldBanishTargetCodes = new Set(["48206762", "74694807"]);
const luaStaticSingleCardRestrictionCodes = new Set([43, 44, 85]);
const luaIndestructibleValueDescriptors = new Set(["indestructible:opponent", "indestructible:self"]);
const luaLifePointReasonPredicateEffectCodes = new Set([80, 81]);
const luaEffectReasonPredicateDescriptor = "value-predicate:effect-reason";
const luaReasonMaskPredicateDescriptorPrefix = "value-predicate:reason-mask:";
const luaValueCardNotHandlerDescriptor = "value-card:not-handler";
const luaCannotActivateSpecialSummonedMonsterDescriptor = "cannot-activate:special-summoned-monster-on-field";
const luaCannotActivateNonSpiritMonsterDescriptor = "cannot-activate:non-spirit-monster-effect";
const luaSourceControllerConditionDescriptor = "condition:source-controller"; const luaNotDrawPhaseConditionDescriptor = "condition:not-draw-phase"; const luaSourceEquippedConditionDescriptor = "condition:source-equipped";
const luaMaharaghiCode = "40695128";
const luaHinoKaguTsuchiCode = "75745607";
const luaGreatLongNoseCode = "2356994";
const luaXxSaberDarksoulCode = "31383545";
const luaFamiliarPossessedDharcCode = "21390858";
const luaDarkMagicExpandedCode = "111280";
const luaTimeTearingMorganiteCode = "19403423";
const luaMegalithUnformedCode = "69003792";
const luaDaiDanceCode = "50696588";
const luaExosisterCarpedivemCode = "30802207";
const luaEndPhaseReviveDestroyCodes = new Set(["32061744", "37745919", "46874015"]);
const luaLeaveFieldLinkedDestroyCodes = new Set(["29013526", "29139104", "56524813"]);
const luaDelayedBattleDestroyCodes = new Set(["85255550", "86100785"]);
const luaSetMegalith = 0x138;
const luaCategorySpecialSummon = 0x200; const luaLocationDeck = 0x1;
const luaSummonTypeGemini = 0x12000000; const luaLocationMonsterZone = 0x4;
const luaTypeMonster = 0x1; const luaTypeRitual = 0x80; const luaTypeSpirit = 0x200; const luaTypeTuner = 0x1000;
const luaResetEvent = 0x1000; const luaResetChain = 0x80000000; const luaResetTurnSet = 0x20000;
const luaResetPhase = 0x40000000; const luaResetOpponentTurn = 0x20000000;
const luaPhaseBattle = 0x80; const luaPhaseEnd = 0x200;
const luaBattlePhaseEventCode = luaResetEvent | luaPhaseBattle; const luaPhaseEndEventCode = luaResetEvent | luaPhaseEnd;
const luaResetsStandardPhaseEnd = 0x41fe1200;
const luaResetsStandardPhaseEndRuntime = luaResetsStandardPhaseEnd & ~luaResetEvent;
const luaResetEventStandard = luaResetEvent | 0x1fe0000;
const luaTemporaryRestrictionResetFlags = luaResetsStandardPhaseEnd & ~luaResetTurnSet; const luaTemporaryPositionLockResetFlags = luaResetPhase | luaPhaseEnd;
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
  const host = createLuaScriptHost(session, undefined, { reuseExistingLuaEffectIds: true });
  const registryKeys = luaRegistryKeys(snapshot);
  const scriptRegistryKeys = luaScriptRegistryKeys(registryKeys, snapshot.state.effects);
  const loadedScripts = [...luaRegistryCardCodes(scriptRegistryKeys, chainLimitRegistryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  if (loadedScripts.every((result) => result.ok)) restoreLuaHostEffectMetadata(host, snapshot.state.effects);
  const restoredStateScripts = loadedScripts.every((result) => result.ok) ? restoreKnownLuaStateEffects(session, host, registryKeys, snapshot.state.effects) : [];
  restoreKnownLuaChainLimits(session, host, chainLimitRegistryKeys);
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys, snapshot.state.effects);
  restoredRegistryKeys.push(...restoreKnownLuaEffects(session, registryKeys, snapshot.state.effects, restoredRegistryKeys));
  restoreKnownLuaChainOperations(session);
  session.state.effects = session.state.effects.map(restoredLuaEffectWithoutPromptOperation);
  prunePendingTriggersWithoutEffects(session.state);
  const missingRegistryKeys = [...registryKeys].filter((key) => !restoredRegistryKeys.includes(key));
  const restoredChainLimitRegistryKeys = luaChainLimitRegistryKeys({ ...snapshot, state: session.state });
  const missingChainLimitRegistryKeys = chainLimitRegistryKeys.filter((key) => !restoredChainLimitRegistryKeys.includes(key));
  const incompleteReasons = luaRestoreIncompleteReasons([...loadedScripts, ...restoredStateScripts], missingRegistryKeys, missingChainLimitRegistryKeys);
  const restoreComplete = incompleteReasons.length === 0;
  return { session, host, restoreComplete, loadedScripts: [...loadedScripts, ...restoredStateScripts], registeredEffects, restoredRegistryKeys, missingRegistryKeys, chainLimitRegistryKeys, missingChainLimitRegistryKeys, incompleteReasons };
}

function restoreLuaHostEffectMetadata(host: LuaScriptHost, snapshotEffects: SerializedDuelEffect[]): void {
  for (const effect of snapshotEffects) {
    if (!effect.registryKey?.startsWith("lua:")) continue;
    host.restoreEffectMetadata(effect.registryKey, {
      ...(effect.label === undefined ? {} : { label: effect.label }),
      ...(effect.labelObjectId === undefined ? {} : { labelObjectId: effect.labelObjectId }),
    });
  }
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
  const result = applyResponse(restored.session, response);
  if (!result.ok) return result;
  return drainRestoredLuaOperationPrompts(restored, result);
}

function drainRestoredLuaOperationPrompts(restored: LuaSnapshotRestoreResult, initial: ApplyDuelResponseResult): ApplyDuelResponseResult {
  let result = initial;
  while (result.ok && restored.session.state.luaOperationPrompt && restored.session.state.prompt?.origin === "luaOperation") {
    const prompt = restored.session.state.prompt;
    const luaPrompt = restored.session.state.luaOperationPrompt.prompt;
    const response = defaultLuaPromptResponse(restored.session, prompt, luaPrompt);
    if (!response) break;
    result = applyResponse(restored.session, response);
  }
  return result;
}

function defaultLuaPromptResponse(
  session: DuelSession,
  prompt: NonNullable<DuelSession["state"]["prompt"]>,
  luaPrompt: NonNullable<DuelSession["state"]["luaOperationPrompt"]>["prompt"],
): DuelResponse | undefined {
  if (prompt.type === "selectOption" && isLuaOptionPromptDecision(luaPrompt)) {
    return getLegalActions(session, prompt.player).find((action) => action.type === "selectOption" && action.promptId === prompt.id && action.option === luaPrompt.returned);
  }
  if (prompt.type === "selectYesNo" && isLuaYesNoPromptDecision(luaPrompt)) {
    return getLegalActions(session, prompt.player).find((action) => action.type === "selectYesNo" && action.promptId === prompt.id && action.yes === luaPrompt.returned);
  }
  return undefined;
}

function filterRestoredLuaEffects(session: DuelSession, registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): string[] {
  if (registryKeys.size === 0) return [];
  const snapshotEffectsByKey = new Map(snapshotEffects.map((effect) => [effect.registryKey, effect]).filter((entry): entry is [string, SerializedDuelEffect] => Boolean(entry[0])));
  const semanticSnapshotEffectsByLiveKey = new Map<string, SerializedDuelEffect>();
  const semanticRegistryKeys = new Set<string>();
  const liveLuaEffectsByKey = liveLuaCallbackEffectsByRegistryKey(session.state.effects, registryKeys);
  session.state.effects = session.state.effects
    .filter((effect) => {
      if (effect.registryKey === undefined || registryKeys.has(effect.registryKey)) return true;
      const snapshotEffect = findRestoredLuaStateSnapshotEffect(session, effect, registryKeys, snapshotEffects, semanticRegistryKeys);
      if (!snapshotEffect) return false;
      semanticSnapshotEffectsByLiveKey.set(effect.registryKey, snapshotEffect);
      semanticRegistryKeys.add(snapshotEffect.registryKey!);
      return true;
    })
    .map((effect) => {
      const snapshotEffect = snapshotEffectsByKey.get(effect.registryKey ?? "") ?? semanticSnapshotEffectsByLiveKey.get(effect.registryKey ?? "");
      const rebound = rebindRestoredLuaEffectCallbacks(effect, liveLuaEffectsByKey.get(effect.registryKey ?? ""));
      return mergeRestoredLuaEffectMetadata(rebound, snapshotEffect);
    });
  const exactRegistryKeys = session.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:") && registryKeys.has(key)));
  return [...new Set([...exactRegistryKeys, ...semanticRegistryKeys])];
}

function liveLuaCallbackEffectsByRegistryKey(effects: DuelEffectDefinition[], registryKeys: Set<string>): Map<string, DuelEffectDefinition> {
  const liveEffects = new Map<string, DuelEffectDefinition>();
  for (const effect of effects) {
    if (!effect.registryKey || !registryKeys.has(effect.registryKey)) continue;
    if (!hasLiveLuaCallbacks(effect)) continue;
    const existing = liveEffects.get(effect.registryKey);
    if (!existing || (existing.id === effect.id && effect.operation !== undefined)) liveEffects.set(effect.registryKey, effect);
  }
  return liveEffects;
}

function hasLiveLuaCallbacks(effect: DuelEffectDefinition): boolean {
  return Boolean(effect.operation || effect.promptOperation || effect.canActivate || effect.cost || effect.target);
}

function rebindRestoredLuaEffectCallbacks(effect: DuelEffectDefinition, liveEffect: DuelEffectDefinition | undefined): DuelEffectDefinition {
  if (!liveEffect || liveEffect === effect) return restoredLuaEffectWithoutPromptOperation(effect);
  const restoredEffect = restoredLuaEffectWithoutPromptOperation(effect);
  return {
    ...restoredEffect,
    ...(liveEffect.canActivate === undefined ? {} : { canActivate: liveEffect.canActivate }),
    ...(liveEffect.cost === undefined ? {} : { cost: liveEffect.cost }),
    ...(liveEffect.target === undefined ? {} : { target: liveEffect.target }),
    ...(liveEffect.operation === undefined ? {} : { operation: liveEffect.operation }),
    ...(liveEffect.battleDamageValue === undefined ? {} : { battleDamageValue: liveEffect.battleDamageValue }),
    ...(liveEffect.lifePointValue === undefined ? {} : { lifePointValue: liveEffect.lifePointValue }),
    ...(liveEffect.statValue === undefined ? {} : { statValue: liveEffect.statValue }),
    ...(liveEffect.targetCardPredicate === undefined ? {} : { targetCardPredicate: liveEffect.targetCardPredicate }),
    ...(liveEffect.valueCardPredicate === undefined ? {} : { valueCardPredicate: liveEffect.valueCardPredicate }),
    ...(liveEffect.valuePredicate === undefined ? {} : { valuePredicate: liveEffect.valuePredicate }),
  };
}

function restoredLuaEffectWithoutPromptOperation(effect: DuelEffectDefinition): DuelEffectDefinition {
  const { promptOperation: _promptOperation, ...rest } = effect;
  return rest;
}

function mergeRestoredLuaEffectMetadata(effect: DuelEffectDefinition, snapshotEffect: SerializedDuelEffect | undefined): DuelEffectDefinition {
  if (!snapshotEffect) return effect;
  return {
    ...effect, ...((snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-battle-target") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-status-summon-type:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-relate-battle-target") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-own-faceup:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-opponent-mzone-count-at-least:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:controller-has-faceup-setcode:") === true || snapshotEffect.luaConditionDescriptor === "condition:damage-source-relate-battle-target" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all-player:") === true || snapshotEffect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-side-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason-player:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-position:") === true) ? restoredLuaConditionCallbacks(snapshotEffect) : {}),
    ...(snapshotEffect.property === undefined ? {} : { property: snapshotEffect.property }),
    ...(snapshotEffect.reset === undefined ? {} : { reset: { ...snapshotEffect.reset } }),
    ...(snapshotEffect.label === undefined ? {} : { label: snapshotEffect.label }),
    ...(snapshotEffect.labelObjectId === undefined ? {} : { labelObjectId: snapshotEffect.labelObjectId }),
    ...(snapshotEffect.labelObjectUid === undefined ? {} : { labelObjectUid: snapshotEffect.labelObjectUid }),
    ...(snapshotEffect.labelObjectUids === undefined ? {} : { labelObjectUids: [...snapshotEffect.labelObjectUids] }),
    ...restoredLuaValueCallbacks(snapshotEffect),
    ...restoredLuaTargetCallbacks(snapshotEffect),
  };
}

function findRestoredLuaStateSnapshotEffect(
  session: DuelSession,
  effect: DuelEffectDefinition,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: Set<string>,
): SerializedDuelEffect | undefined {
  if (!isKnownLuaUnionStateEffect(session, effect) && !isKnownLuaGeminiStateEffect(effect) && !isKnownLuaMaterialSourceOnlyEventEffect(effect)) return undefined;
  return snapshotEffects.find((snapshotEffect) => {
    if (!snapshotEffect.registryKey || !registryKeys.has(snapshotEffect.registryKey) || restoredRegistryKeys.has(snapshotEffect.registryKey)) return false;
    return (
      snapshotEffect.sourceUid === effect.sourceUid &&
      snapshotEffect.event === effect.event &&
      snapshotEffect.code === effect.code &&
      (isKnownLuaUnionStateEffect(session, snapshotEffect) || isKnownLuaGeminiStateEffect(snapshotEffect) || isKnownLuaMaterialSourceOnlyEventEffect(snapshotEffect))
    );
  });
}

function isKnownLuaUnionStateEffect(session: DuelSession, effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  if (effect.event !== "continuous" || effect.code === undefined || !luaUnionStateEffectCodes.has(effect.code)) return false;
  const source = session.state.cards.find((card) => card.uid === effect.sourceUid);
  return Boolean(source && source.location === "spellTrapZone" && source.equippedToUid !== undefined);
}

function isKnownLuaGeminiStateEffect(effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === luaEffectGeminiStatus || effect.code === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

function isKnownLuaMaterialSourceOnlyEventEffect(effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 1108 &&
    effect.sourceUid !== undefined &&
    effect.triggerEvent === "usedAsMaterial" &&
    effect.triggerCode === 1108 &&
    effect.range.length === duelLocations.length &&
    duelLocations.every((location) => effect.range.includes(location))
  );
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
  const geminiStatusSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownGeminiStatusEffect(effect))
      .map((effect) => effect.sourceUid),
  );
  const geminiReturnSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects))
      .map((effect) => effect.sourceUid),
  );
  const darksoulEndSearchSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownXxSaberDarksoulEndSearchEffect(effect))
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
  for (const sourceUid of new Set([...geminiStatusSourceUids, ...geminiReturnSourceUids])) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "monsterZone") continue;
    const restoreStatus = geminiStatusSourceUids.has(sourceUid);
    const restoreReturn = geminiReturnSourceUids.has(sourceUid);
    const script = `
      local c=Duel.GetFieldCard(${card.controller},LOCATION_MZONE,${card.sequence})
      if c and c:IsFieldID(${cardFieldId(card)}) then
        ${restoreStatus ? "c:EnableGeminiStatus()" : ""}
        ${restoreReturn ? `
          local e1=Effect.CreateEffect(c)
          e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
          e1:SetCode(EVENT_PHASE+PHASE_END)
          e1:SetRange(LOCATION_MZONE)
          e1:SetCountLimit(1)
          e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Duel.SendtoHand(e:GetHandler(),nil,REASON_EFFECT)
          end)
          e1:SetReset(RESETS_STANDARD_PHASE_END)
          c:RegisterEffect(e1,true)
        ` : ""}
      end
    `;
    results.push(host.loadScript(script, `restore-gemini-status-${card.uid}.lua`));
  }
  for (const sourceUid of darksoulEndSearchSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "graveyard") continue;
    const script = `
      local c=Duel.GetFirstMatchingCard(function(tc) return tc:IsFieldID(${cardFieldId(card)}) end,${card.controller},LOCATION_GRAVE,0,nil)
      if c then
        local e1=Effect.CreateEffect(c)
        e1:SetDescription(aux.Stringid(${luaXxSaberDarksoulCode},0))
        e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
        e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
        e1:SetCode(EVENT_PHASE+PHASE_END)
        e1:SetCountLimit(1)
        e1:SetRange(LOCATION_GRAVE)
        e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(function(tc) return tc:IsSetCard(SET_X_SABER) and tc:IsMonster() and tc:IsAbleToHand() end,tp,LOCATION_DECK,0,1,nil) end
          Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
        end)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
          local g=Duel.SelectMatchingCard(tp,function(tc) return tc:IsSetCard(SET_X_SABER) and tc:IsMonster() and tc:IsAbleToHand() end,tp,LOCATION_DECK,0,1,1,nil)
          if #g>0 then
            Duel.SendtoHand(g,nil,REASON_EFFECT)
            Duel.ConfirmCards(1-tp,g)
          end
        end)
        e1:SetReset(RESETS_STANDARD_PHASE_END)
        c:RegisterEffect(e1)
      end
    `;
    results.push(host.loadScript(script, `restore-xx-saber-darksoul-end-search-${card.uid}.lua`));
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
    if (!effect.registryKey) continue;
    const knownRestorable = isKnownRestorableLuaEffect(effect, snapshotEffects);
    if (!registryKeys.has(effect.registryKey) && !(knownRestorable && isKnownEngraverOfTheMarkDelayedDestroyEffect(effect))) continue;
    refreshKnownRestoredLuaEffect(session, effect);
    if (restored.has(effect.registryKey)) continue;
    if (!knownRestorable) continue;
    const reset = restoredLuaEffectReset(session, effect);
    session.state.effects.push({
      ...effect,
      range: [...effect.range],
      ...(reset ? { reset } : {}),
      ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
      ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
      ...restoredLuaValueCallbacks(effect),
      ...restoredLuaConditionCallbacks(effect), ...restoredLuaCostCallbacks(effect),
      ...restoredLuaTargetCallbacks(effect),
      operation: restoredLuaOperation(effect, snapshotEffects),
    });
    added.push(effect.registryKey);
  }
  return added;
}

function refreshKnownRestoredLuaEffect(session: DuelSession, effect: SerializedDuelEffect): void {
  if (!effect.registryKey || (!isKnownSelfEndPhaseDestroyEffect(effect) && !isKnownSelfEndPhaseSendEffect(effect) && !isKnownDelayedBattleDestroyPhaseEffect(effect))) return;
  const restored = session.state.effects.find((candidate) => candidate.registryKey === effect.registryKey);
  if (!restored) return;
  Object.assign(restored, {
    operation: restoredLuaOperation(effect),
    ...restoredLuaConditionCallbacks(effect),
    ...restoredLuaTargetCallbacks(effect),
  });
}

function restoredLuaEffectReset(session: DuelSession, effect: SerializedDuelEffect): DuelEffectDefinition["reset"] | undefined {
  if (!effect.reset) return undefined;
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) return swordsOfRevealingLightRestoredReset(session, effect);
  if (isKnownEngraverOfTheMarkDelayedDestroyEffect(effect)) {
    const sameTurnFlag = session.state.flagEffects.some((flag) => flag.ownerType === "card" && flag.code === 50078320 && flag.value === effect.label && flag.turn === session.state.turn);
    return sameTurnFlag ? { ...effect.reset, count: Math.max(effect.reset.count ?? 3, 3) } : { ...effect.reset };
  }
  return { ...effect.reset };
}

function restoreKnownLuaChainOperations(session: DuelSession): void {
  for (const link of session.state.chain) {
    if (isKnownMegalithUnformedDeckRitualChainLink(session, link)) link.operationOverride = megalithUnformedDeckRitualOperation();
  }
}

function isKnownMegalithUnformedDeckRitualChainLink(session: DuelSession, link: ChainLink): boolean {
  const source = findCard(session.state, link.sourceUid);
  return Boolean(
    source?.code === luaMegalithUnformedCode &&
      link.operationInfos?.some((info) => info.category === luaCategorySpecialSummon && info.player === link.player && info.parameter === luaLocationDeck && info.count > 0),
  );
}

function megalithUnformedDeckRitualOperation(): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const selection = selectMegalithUnformedDeckRitual(ctx.duel, ctx.player);
    if (!selection) return;
    const session = { state: ctx.duel, cardReader: fallbackCardReader };
    try {
      ritualSummonSelectedMaterials(session, luaRestoreSummonHostState(), selection.target, selection.materialUids, false, "faceUpDefense");
    } catch {
      // EDOPro-style operation restore leaves the chain resolved if the selected summon is no longer legal.
    }
  };
}

function selectMegalithUnformedDeckRitual(
  state: DuelSession["state"],
  player: PlayerId,
): { target: DuelCardInstance; materialUids: string[] } | undefined {
  const targets = state.cards.filter((card) => isMegalithUnformedDeckRitualTarget(state, player, card)).sort((a, b) => a.sequence - b.sequence);
  for (const target of targets) {
    const materialUids = selectMegalithUnformedRitualMaterials(state, player, target);
    if (materialUids) return { target, materialUids };
  }
  return undefined;
}

function isMegalithUnformedDeckRitualTarget(state: DuelSession["state"], player: PlayerId, card: DuelCardInstance): boolean {
  const summonReason = duelReason.summon | duelReason.specialSummon | duelReason.ritual;
  return (
    card.controller === player &&
    card.location === "deck" &&
    (cardTypeFlags(card, state) & (luaTypeMonster | luaTypeRitual)) === (luaTypeMonster | luaTypeRitual) &&
    currentCardMatchesSetcode(card, state, luaSetMegalith) &&
    canPlayerSpecialSummon(state, player, card, luaSummonTypeRitual) &&
    canMoveDuelCardToLocation(state, card.uid, "monsterZone", summonReason)
  );
}

function selectMegalithUnformedRitualMaterials(state: DuelSession["state"], player: PlayerId, target: DuelCardInstance): string[] | undefined {
  const requiredLevel = currentLevel(target, state) * 2;
  if (requiredLevel <= 0) return undefined;
  const materialCandidates = state.cards
    .filter((card) => isMegalithUnformedRitualMaterial(state, player, target, card))
    .sort((a, b) => luaRestoreLocationSort(a.location) - luaRestoreLocationSort(b.location) || a.sequence - b.sequence);
  return selectExactLevelMaterials(state, materialCandidates, requiredLevel);
}

function isMegalithUnformedRitualMaterial(state: DuelSession["state"], player: PlayerId, target: DuelCardInstance, card: DuelCardInstance): boolean {
  return (
    card.controller === player &&
    card.uid !== target.uid &&
    (card.location === "hand" || card.location === "monsterZone") &&
    (cardTypeFlags(card, state) & luaTypeMonster) !== 0 &&
    canMoveDuelCardToLocation(state, card.uid, "graveyard", duelReason.material | duelReason.ritual)
  );
}

function selectExactLevelMaterials(state: DuelSession["state"], candidates: DuelCardInstance[], requiredLevel: number): string[] | undefined {
  const search = (startIndex: number, remainingLevel: number, selected: string[]): string[] | undefined => {
    if (remainingLevel === 0) return selected.length > 0 ? [...selected] : undefined;
    if (remainingLevel < 0) return undefined;
    for (let index = startIndex; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const level = currentLevel(candidate, state);
      if (level <= 0) continue;
      selected.push(candidate.uid);
      const result = search(index + 1, remainingLevel - level, selected);
      if (result) return result;
      selected.pop();
    }
    return undefined;
  };
  return search(0, requiredLevel, []);
}

function luaRestoreLocationSort(location: DuelCardInstance["location"]): number {
  if (location === "hand") return 0;
  if (location === "monsterZone") return 1;
  return 2;
}

function luaRestoreSummonHostState(): LuaDuelSummonApiHostState {
  return {
    operatedUids: [],
    summonNegatedUids: [],
    effects: new Map(),
    pushEffectTable: () => {},
  };
}

function isKnownRestorableLuaEffect(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[] = []): boolean {
  return (
    isClientHintEffect(effect) ||
    isKnownXyzMaterialAttackGainTriggerEffect(effect) ||
    isKnownSunlitSentinelDelayedStandbyEffect(effect) ||
    isKnownSelfEndPhaseDestroyEffect(effect) ||
    isKnownSelfEndPhaseSendEffect(effect) ||
    (effect.event === "continuous" &&
      (effect.code === 2 ||
        effect.code === 8 ||
        effect.code === 22 ||
        isKnownGeminiStatusEffect(effect) ||
        isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects) ||
        isKnownSpiritAddTypeEffect(effect) ||
        isKnownTemporaryTunerAddTypeEffect(effect) ||
        isKnownXyzMaterialEffectAddType(effect) ||
        isKnownChangeCodeEffect(effect) ||
        isKnownChangeTypeEffect(effect) ||
        isKnownGrantedSpiritEndPhaseReturnEffect(effect, snapshotEffects) ||
        isStaticNotSetcodeSummonRestriction(effect) ||
        isKnownSetcodeTypeExtraSummonRestriction(effect) ||
        isKnownSetSummonCountLimitEffect(effect) ||
        isKnownExtraSummonCountEffect(effect) ||
        isKnownEquipLimitEffect(effect) ||
        isKnownEquipControlEffect(effect) ||
        isKnownEquipLeaveFieldPrecheckEffect(effect) ||
        isKnownEquipLeaveFieldBanishTargetEffect(effect) ||
        isKnownEquipLeaveFieldDestroyTargetEffect(effect) ||
        effect.code === 25 ||
        (effect.code === 60 && effect.value !== undefined) ||
        (effect.code === 92 && (specialSummonTypeNotCostDescriptor(effect.luaCostDescriptor) !== undefined || specialSummonTypeIsCostDescriptor(effect.luaCostDescriptor) !== undefined)) ||
        (effect.code === 30 && effect.luaValueDescriptor?.startsWith("special-summon-condition:") === true) ||
        effect.code === luaEffectClockLizard ||
        isKnownCannotBeMaterialEffect(effect) ||
        (effect.code === 71 && effect.luaValueDescriptor === "cannot-be-effect-target:opponent") ||
        (effect.code === 73 && effect.sourceUid !== undefined && effect.reset !== undefined) ||
        isKnownIndestructibleValueEffect(effect) ||
        effect.luaValueDescriptor === "change-damage:effect-double" || (effect.luaValueDescriptor === "change-damage:effect-zero" && effect.reset !== undefined) ||
        effect.luaValueDescriptor === "reflect-damage:opponent-non-continuous" ||
        isKnownLifePointReasonPredicateEffect(effect) ||
        isKnownIndestructibleCountReasonPredicateEffect(effect) ||
        isKnownCannotSelectBattleTargetNotHandlerEffect(effect) ||
        isKnownChangeBattleStatToDefenseEffect(effect) ||
        isKnownDharcProcedurePierceEffect(effect) ||
        isKnownYellowAlertDelayedReturnEffect(effect) ||
        isKnownCalledByTheGraveChainSolvingNegateEffect(effect) ||
        isKnownSameOriginalCodeChainSolvingNegateEffect(effect) ||
        isKnownGishkiEmiliaTrapNegateEffect(effect) ||
        isKnownRareMetalmorphChainSolvingNegateEffect(effect) ||
        isKnownCarpedivemTurnEndHintResetEffect(effect) ||
        isKnownTrapMonsterDisableEffect(effect) ||
        isKnownBookOfEclipsePhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightPhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightResetEffect(effect) ||
        isKnownTemporaryPlayerAttackAnnounceLockEffect(effect) || isKnownTemporaryAttackAnnounceNegateEffect(effect) || isKnownTemporaryCannotAttackEffect(effect) || isKnownTemporaryCannotAttackAnnounceSelfEffect(effect) || isKnownTemporaryDirectAttackEffect(effect) || isKnownTemporaryBattleProtectionEffect(effect) || isKnownTemporaryPlayerHalfBattleDamageEffect(effect) || isKnownPlayerDamageZeroEffect(effect) || isKnownTemporaryMonsterNoBattleDamageEffect(effect) || isKnownTemporaryMonsterExtraAttackEffect(effect) || isKnownTemporaryMustAttackEffect(effect) || isKnownTemporarySummonSetLockEffect(effect) || isKnownTemporaryActivationLockEffect(effect) || isKnownTemporaryForbiddenCardEffect(effect) || isKnownStaticForbiddenCardEffect(effect) || isKnownTemporarySelfTurnSkipBattlePhaseEffect(effect) || isKnownTemporaryOpponentTurnSkipMain1Effect(effect) || isKnownTemporaryOpponentTurnSkipMain2Effect(effect) || isKnownTemporarySelfTurnCannotEndPhaseEffect(effect) || isKnownTemporarySameCodeActivationOathEffect(effect) || isKnownTemporaryOpponentTurnSkipTurnEffect(effect) || isKnownTemporaryOpponentCannotBattlePhaseEffect(effect) || isKnownTemporaryArtifactLanceaBanishLockEffect(effect) || isKnownTemporaryEarthshatteringDeckGraveLockEffect(effect) ||
        isAssaultZoneExtraDeckReleaseRestoreEffect(effect) ||
        isKnownMaharaghiPredrawEffect(effect) ||
        isKnownHinoKaguTsuchiPredrawDiscardEffect(effect) ||
        isKnownGreatLongNoseSkipBattlePhaseEffect(effect) ||
        isKnownUnleashYourPowerDelayedSetEffect(effect) ||
        isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect) ||
        isKnownEngraverOfTheMarkDelayedDestroyEffect(effect) ||
        isKnownMulcharmyDrawWatcherEffect(effect) ||
        isKnownMulcharmyEndPhaseShuffleEffect(effect) ||
        isKnownLevelNormalEndPhaseDestroyEffect(effect) ||
        isKnownDelayedBattleDestroyMarkerEffect(effect) ||
        isKnownDelayedBattleDestroyPhaseEffect(effect) ||
        isKnownEndPhaseReviveDestroyEffect(effect) ||
        isKnownLeaveFieldLinkedDestroyEffect(effect) ||
        isKnownDarkMagicExpandedChainingLimitEffect(effect) ||
        isKnownTimeTearingMorganiteSummonLimitEffect(effect) ||
        isKnownDaiDanceForceMonsterZoneEffect(effect) ||
        isKnownDaiDanceAdjustEffect(effect) ||
        isKnownRemainFieldEffect(effect) ||
        isKnownCannotActivateSpecialSummonedMonsterEffect(effect) ||
        isKnownCannotActivateNonSpiritMonsterEffect(effect) ||
        isKnownCannotActivateLocationMonsterEffect(effect) ||
        isKnownDoubleSnareValidityEffect(effect) ||
        isKnownSetcodeOrCodeTypeBattleProtectionEffect(effect) ||
        effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor ||
        isStaticSingleCardLuaRestriction(effect) ||
        isStaticPlayerPhaseLock(effect) ||
        (effect.code === 102 && effect.value !== undefined && effect.targetRange === undefined) ||
        isKnownStatValueEffect(effect)))
  );
}

function isKnownChangeBattleStatToDefenseEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 198 && effect.luaValueDescriptor === "stat:current-defense" && effect.luaTargetDescriptor === "target:source-or-battle-target" && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "monsterZone" && effect.targetRange?.[0] === 4 && effect.targetRange?.[1] === 4 && effect.reset !== undefined; }
function isKnownChangeCodeEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 114 && effect.value !== undefined && effect.sourceUid !== undefined && effect.targetRange === undefined; }
function isKnownChangeTypeEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 117 && effect.value !== undefined && effect.sourceUid !== undefined && effect.targetRange === undefined; }
function isKnownDharcProcedurePierceEffect(effect: SerializedDuelEffect): boolean { return Boolean(effect.registryKey?.startsWith(`lua:${luaFamiliarPossessedDharcCode}:`)) && effect.event === "continuous" && effect.code === luaEffectPierce && effect.sourceUid !== undefined && hasDefaultLuaFieldRange(effect) && effect.reset?.flags === 0xff1000; }
function isKnownTemporaryMustAttackEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && (effect.code === 191 || (effect.code === 344 && effect.label !== undefined)) && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "monsterZone" && effect.reset !== undefined; }

function isKnownStatValueEffect(effect: SerializedDuelEffect): boolean { return effect.code !== undefined && [100, 102, 103, 104, 106, 107, 130, 131, 132, 134, 135, 136, 137, 314].includes(effect.code) && (effect.value !== undefined || luaValueDescriptorStatValue(effect.luaValueDescriptor, effect.id) !== undefined); }
function isKnownEquipControlEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" && effect.code === 4 && effect.sourceUid !== undefined && effect.value !== undefined && effect.reset !== undefined;
}
function isKnownEquipLimitEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" && effect.code === luaEffectEquipLimit && effect.sourceUid !== undefined && effect.reset !== undefined;
}
function isKnownEquipLeaveFieldPrecheckEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" && effect.code === 1019 && effect.sourceUid !== undefined && effect.reset !== undefined;
}
function isKnownEquipLeaveFieldBanishTargetEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaEquipLeaveFieldBanishTargetCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === 1015 &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined
  );
}
function isKnownEquipLeaveFieldDestroyTargetEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" && effect.code === 1015 && effect.sourceUid !== undefined && effect.reset !== undefined;
}
function isKnownDelayedBattleDestroyMarkerEffect(effect: SerializedDuelEffect): boolean {
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

function isKnownDelayedBattleDestroyPhaseEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaDelayedBattleDestroyCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.triggerEvent === "phaseEnd" &&
    effect.countLimit === 1
  );
}

function isKnownEndPhaseReviveDestroyEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaEndPhaseReviveDestroyCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.countLimit === 1 &&
    (effect.reset?.flags === luaResetsStandardPhaseEnd || effect.reset?.flags === luaResetsStandardPhaseEndRuntime)
  );
}

function isKnownXxSaberDarksoulEndSearchEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaXxSaberDarksoulCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === luaPhaseEndEventCode &&
    effect.triggerEvent === "phaseEnd" &&
    effect.triggerCode === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    ((effect.category ?? 0) & 0x8) !== 0 &&
    effect.range.length === 1 &&
    effect.range[0] === "graveyard" &&
    effect.countLimit === 1 &&
    (effect.reset?.flags === luaResetsStandardPhaseEnd || effect.reset?.flags === luaResetsStandardPhaseEndRuntime)
  );
}

function isKnownLeaveFieldLinkedDestroyEffect(effect: SerializedDuelEffect): boolean {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  return (
    registryCode !== undefined &&
    luaLeaveFieldLinkedDestroyCodes.has(registryCode) &&
    effect.event === "continuous" &&
    effect.code === 1015 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.reset?.flags === luaResetEventStandard
  );
}

function isKnownMaharaghiPredrawEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaMaharaghiCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1113 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.targetRange === undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownHinoKaguTsuchiPredrawDiscardEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaHinoKaguTsuchiCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1113 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.targetRange === undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownDarkMagicExpandedChainingLimitEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaDarkMagicExpandedCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1027 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function darkMagicExpandedChainingLimitOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const chainLink = ctx.chainLink ?? ctx.duel.chain[ctx.duel.chain.length - 1];
    if (!chainLink || chainLink.player !== effect.controller) return;
    const chainSource = ctx.duel.cards.find((card) => card.uid === chainLink.sourceUid);
    if (!chainSource || (cardTypeFlags(chainSource, ctx.duel) & 0x6) === 0) return;
    addDuelChainLimit(ctx.duel, {
      registryKey: `lua-chain-limit:${luaDarkMagicExpandedCode}:${effect.controller}:link:known:closure:response-matches-chain-player`,
      untilChainEnd: false,
      expiresAtChainLength: ctx.duel.chain.length,
      allows: (_candidate, player, chainPlayer) => player === chainPlayer,
    });
  };
}

function isKnownTimeTearingMorganiteSummonLimitEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaTimeTearingMorganiteCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1100 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function timeTearingMorganiteSummonLimitOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (ctx.eventCard?.summonPlayer !== effect.controller) return;
    addDuelChainLimit(ctx.duel, {
      registryKey: `lua-chain-limit:${luaTimeTearingMorganiteCode}:${effect.controller}:chain:known:closure:not-active-type-response-player:1`,
      untilChainEnd: true,
      allows: (candidate, player, chainPlayer) => player === chainPlayer || (cardTypeFlags(ctx.duel.cards.find((card) => card.uid === candidate.sourceUid), ctx.duel) & 0x1) === 0,
    });
  };
}

function isKnownDaiDanceForceMonsterZoneEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaDaiDanceCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaEffectForceMonsterZone &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.property === luaEffectFlagPlayerTarget &&
    effect.targetRange?.[0] === 0 &&
    effect.targetRange?.[1] === 1 &&
    effect.value !== undefined &&
    (effect.value & 0x60) === 0x60 &&
    [1, 2, 4, 8, 16].includes(effect.value & 0x1f) &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownDaiDanceAdjustEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaDaiDanceCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaEventAdjust &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.label !== undefined &&
    effect.label >= 0 &&
    effect.label <= 4 &&
    hasDefaultLuaFieldRange(effect)
  );
}

function daiDanceAdjustOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (effect.label === undefined || effect.controller === undefined || effect.sourceUid === undefined) return;
    const targetPlayer = effect.controller === 0 ? 1 : 0;
    const occupied = ctx.duel.cards.some((card) => card.controller === targetPlayer && card.location === "monsterZone" && card.sequence === effect.label);
    if (!occupied) return;
    const selectedZoneValue = (1 << effect.label) | 0x60;
    ctx.duel.effects = ctx.duel.effects.filter((candidate) => {
      if (candidate.id === effect.id) return false;
      return !(candidate.sourceUid === effect.sourceUid && candidate.code === luaEffectForceMonsterZone && candidate.value === selectedZoneValue && candidate.targetRange?.[0] === 0 && candidate.targetRange?.[1] === 1);
    });
  };
}

function isKnownGreatLongNoseSkipBattlePhaseEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaGreatLongNoseCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 183 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.targetRange?.[0] === 0 &&
    effect.targetRange?.[1] === 1 &&
    hasDefaultLuaFieldRange(effect)
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
  return (effect.code === 20 || effect.code === 22) && (notSetcodeTargetDescriptor(effect.luaTargetDescriptor) !== undefined || effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-setcode-extra:") === true);
}

function isKnownSetcodeTypeExtraSummonRestriction(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 22 &&
    effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-setcode-type-extra:") === true &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange?.[0] === 1 &&
    (effect.targetRange[1] ?? 0) === 0
  );
}

function isKnownExtraSummonCountEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 29 && effect.targetRange !== undefined && (effect.luaTargetDescriptor === undefined || typeTargetDescriptor(effect.luaTargetDescriptor) !== undefined || setcodeTargetDescriptor(effect.luaTargetDescriptor) !== undefined); }

function isKnownSetSummonCountLimitEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 28 && effect.value !== undefined && effect.targetRange !== undefined && effect.reset !== undefined; }

function isClientHintEffect(effect: SerializedDuelEffect): boolean {
  return effect.code === undefined && ((effect.property ?? 0) & luaEffectFlagClientHint) !== 0;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}

function isStaticSingleCardLuaRestriction(effect: SerializedDuelEffect): boolean {
  if (effect.targetRange !== undefined || effect.sourceUid === undefined || effect.range.length !== 1) return false;
  if (effect.code === 14) return effect.reset?.flags === luaTemporaryPositionLockResetFlags;
  return effect.code !== undefined && luaStaticSingleCardRestrictionCodes.has(effect.code) && isTemporaryRestrictionReset(effect.reset?.flags);
}

function isTemporaryRestrictionReset(flags: number | undefined): boolean {
  return flags === luaTemporaryRestrictionResetFlags || flags === luaResetsStandardPhaseEnd || flags === luaResetEventStandard;
}

function restoredLuaOperation(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[] = []): DuelEffectDefinition["operation"] {
  if (isKnownYellowAlertDelayedReturnEffect(effect)) return yellowAlertDelayedReturnOperation(effect);
  if (isKnownCalledByTheGraveChainSolvingNegateEffect(effect)) return calledByTheGraveChainSolvingNegateOperation(effect);
  if (isKnownSameOriginalCodeChainSolvingNegateEffect(effect)) return calledByTheGraveChainSolvingNegateOperation(effect);
  if (isKnownGishkiEmiliaTrapNegateEffect(effect)) return gishkiEmiliaTrapNegateOperation(effect);
  if (isKnownRareMetalmorphChainSolvingNegateEffect(effect)) return rareMetalmorphChainSolvingNegateOperation(effect);
  if (isKnownCarpedivemTurnEndHintResetEffect(effect)) return () => {};
  if (isKnownBookOfEclipsePhaseEndEffect(effect)) return bookOfEclipsePhaseEndOperation(effect);
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) return swordsOfRevealingLightPhaseEndOperation();
  if (isKnownMaharaghiPredrawEffect(effect)) return maharaghiPredrawOperation(effect);
  if (isKnownHinoKaguTsuchiPredrawDiscardEffect(effect)) return hinoKaguTsuchiPredrawDiscardOperation(effect);
  if (isKnownSunlitSentinelDelayedStandbyEffect(effect)) return sunlitSentinelDelayedStandbyOperation(effect);
  const assaultZoneOperation = assaultZoneReleaseFlagOperation(effect);
  if (assaultZoneOperation) return assaultZoneOperation;
  if (isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownGrantedSpiritEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownUnleashYourPowerDelayedSetEffect(effect)) return unleashYourPowerDelayedSetOperation(effect);
  if (isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect)) return tsumuhaKutsunagiDelayedShuffleOperation(effect);
  if (isKnownEngraverOfTheMarkDelayedDestroyEffect(effect)) return engraverOfTheMarkDelayedDestroyOperation(effect);
  if (isKnownMulcharmyDrawWatcherEffect(effect)) return mulcharmyDrawWatcherOperation(effect);
  if (isKnownMulcharmyEndPhaseShuffleEffect(effect)) return mulcharmyEndPhaseShuffleOperation(effect);
  if (isKnownLevelNormalEndPhaseDestroyEffect(effect)) return levelNormalEndPhaseDestroyOperation(effect);
  if (isKnownDelayedBattleDestroyPhaseEffect(effect)) return delayedBattleDestroyPhaseOperation(effect);
  if (isKnownEndPhaseReviveDestroyEffect(effect)) return luaHandlerDestroyOperation(effect);
  if (isKnownSelfEndPhaseDestroyEffect(effect)) return selfEndPhaseDestroyOperation(effect);
  if (isKnownSelfEndPhaseSendEffect(effect)) return selfEndPhaseSendOperation(effect);
  if (isKnownLeaveFieldLinkedDestroyEffect(effect)) return luaLinkedLeaveFieldDestroyOperation(effect);
  if (isKnownEquipLeaveFieldBanishTargetEffect(effect)) return luaEquipLeaveFieldBanishTargetOperation(effect);
  if (isKnownEquipLeaveFieldDestroyTargetEffect(effect)) return luaEquipLeaveFieldDestroyTargetOperation(effect);
  if (isKnownDarkMagicExpandedChainingLimitEffect(effect)) return darkMagicExpandedChainingLimitOperation(effect);
  if (isKnownTimeTearingMorganiteSummonLimitEffect(effect)) return timeTearingMorganiteSummonLimitOperation(effect);
  if (isKnownDaiDanceAdjustEffect(effect)) return daiDanceAdjustOperation(effect);
  if (isKnownXyzMaterialAttackGainTriggerEffect(effect)) return xyzMaterialAttackGainOperation(effect);
  if (isKnownTemporaryAttackAnnounceNegateEffect(effect)) return temporaryAttackAnnounceNegateOperation(effect);
  if (effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor) {
    const returnPlayer = effect.value === 0 || effect.value === 1 ? effect.value : undefined;
    return luaTemporaryControlReturnOperation(returnPlayer);
  }
  return () => {};
}

function isKnownCarpedivemTurnEndHintResetEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaExosisterCarpedivemCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1210 &&
    effect.triggerEvent === "turnEnded";
}

function luaEquipLeaveFieldDestroyTargetOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const targetUid = source?.previousEquippedToUid ?? source?.equippedToUid;
    const target = targetUid === undefined ? undefined : findCard(ctx.duel, targetUid);
    if (!target || target.location !== "monsterZone") return;
    try {
      destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
      });
    } catch {
      // EDOPro-style equip cleanup ignores targets that are no longer destroyable.
    }
  };
}

function luaEquipLeaveFieldBanishTargetOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const targetUid = source?.previousEquippedToUid ?? source?.equippedToUid;
    const target = targetUid === undefined ? undefined : findCard(ctx.duel, targetUid);
    if (!target || target.location !== "monsterZone") return;
    try {
      banishDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
    } catch {
      // EDOPro-style equip cleanup ignores targets that are no longer removable.
    }
  };
}

function delayedBattleDestroyPhaseOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  const markerCode = registryCode === undefined ? undefined : Number(registryCode);
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

function maharaghiPredrawOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const [topCard] = topDeckCards(ctx.duel, effect.controller);
    if (!topCard) return;
    collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [topCard], {
      eventCode: 1211,
      eventPlayer: effect.controller,
      eventValue: 1,
      eventUids: [topCard.uid],
    });
  };
}

function hinoKaguTsuchiPredrawDiscardOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const opponent = otherPlayer(effect.controller);
    const hand = ctx.duel.cards.filter((card) => card.controller === opponent && card.location === "hand");
    for (const card of hand) {
      try {
        moveDuelCardWithRedirects(ctx.duel, card.uid, "graveyard", card.controller, duelReason.effect | duelReason.discard, effect.controller, {
          eventReasonCardUid: effect.sourceUid,
        });
      } catch {
        // EDOPro-style delayed operations ignore cards that can no longer move.
      }
    }
  };
}

function luaHandlerReturnToHandOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    try {
      moveDuelCardWithRedirects(ctx.duel, ctx.source.uid, "hand", ctx.source.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
      });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer move.
    }
  };
}

function restoredLuaValueCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "battleDamageValue" | "lifePointValue" | "statValue" | "valueCardPredicate" | "valuePredicate"> {
  const descriptorStatValue = luaValueDescriptorStatValue(effect.luaValueDescriptor, effect.id);
  if (descriptorStatValue) return { statValue: descriptorStatValue };
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
  const assaultZoneValueCallbacks = assaultZoneExtraDeckReleaseValueCallbacks(effect);
  if (assaultZoneValueCallbacks.valuePredicate) return assaultZoneValueCallbacks;
  const reasonMask = luaReasonPredicateMask(effect.luaValueDescriptor);
  if (reasonMask !== undefined) {
    return { valuePredicate: (ctx) => ((ctx.eventReason ?? 0) & reasonMask) !== 0 };
  }
  if (effect.luaValueDescriptor === luaValueCardNotHandlerDescriptor) {
    return { valueCardPredicate: (_ctx, card) => card.uid !== effect.sourceUid };
  }
  if (effect.luaValueDescriptor === "value-card:not-facedown") return { valueCardPredicate: (_ctx, card) => card.faceUp || !String(card.position).toLowerCase().includes("facedown") };
  if (effect.luaValueDescriptor?.startsWith("value-card:race:")) return { valueCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) !== 0 };
  if (effect.luaValueDescriptor?.startsWith("value-card:attribute:")) return { valueCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) !== 0 };
  if (effect.luaValueDescriptor === luaCannotActivateSpecialSummonedMonsterDescriptor) {
    return { valuePredicate: (ctx) => relatedEffectIsSpecialSummonedMonsterOnField(ctx) };
  }
  if (effect.luaValueDescriptor === luaCannotActivateNonSpiritMonsterDescriptor) return { valuePredicate: (ctx) => relatedEffectIsNonSpiritMonsterEffect(ctx) };
  if (effect.luaValueDescriptor === "cannot-activate:card-activation") return { valuePredicate: (ctx) => ((relatedEffectFromContext(ctx)?.luaTypeFlags ?? 0) & 0x10) !== 0 };
  if (effect.luaValueDescriptor === "cannot-activate:spell-card-activation" || effect.luaValueDescriptor === "cannot-activate:trap-card-activation") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const type = effect.luaValueDescriptor === "cannot-activate:spell-card-activation" ? 0x2 : 0x4; return Boolean(handler && ((relatedEffect?.luaTypeFlags ?? 0) & 0x10) !== 0 && (cardTypeFlags(handler, ctx.duel) & type) !== 0); } };
  if (effect.luaValueDescriptor === "cannot-activate:same-code") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaValueDescriptor === "cannot-activate:same-code-monster-effect") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } }; if (isKnownTemporarySameCodeActivationOathEffect(effect)) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(source && handler && ((relatedEffect?.luaTypeFlags ?? 0) & 0x10) !== 0 && currentCardMatchesCode(handler, ctx.duel, source.code)); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:same-code-monster-effect-location:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const location = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label)) && (cardLocationMask(handler.location) & location) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:setcode-monster-effect:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const setcode = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && currentCardMatchesSetcode(handler, ctx.duel, setcode)); } };
  if (effect.luaValueDescriptor === "cannot-activate:spell-trap-effect") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & 0x6) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:location-monster-effect:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const mask = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && (cardLocationMask(handler.location) & mask) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:monster-attribute-except:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const attribute = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && ((handler.data.attribute ?? 0) & ~attribute) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-material:summon-types:")) {
    const summonTypes = effect.luaValueDescriptor.slice("cannot-material:summon-types:".length).split(",").map(Number);
    return { valuePredicate: (ctx) => summonTypes.includes(ctx.summonTypeCode ?? 0) };
  }
  const specialSummonConditionCallbacks = restoredSpecialSummonConditionValueCallbacks(effect);
  if (specialSummonConditionCallbacks.valuePredicate) return specialSummonConditionCallbacks;
  if (effect.luaValueDescriptor?.startsWith("cannot-material:controller-summon-types:")) { const summonTypes = effect.luaValueDescriptor.slice("cannot-material:controller-summon-types:".length).split(",").map(Number); return { valuePredicate: (ctx) => summonTypes.includes(ctx.summonTypeCode ?? 0) && ctx.eventCard?.controller === effect.controller }; }
  if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-setcode:")) return { valuePredicate: (ctx) => !ctx.eventCard || !currentCardMatchesSetcode(ctx.eventCard, ctx.duel, Number(effect.luaValueDescriptor?.split(":").pop())) }; if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-race:")) return { valuePredicate: (ctx) => !ctx.eventCard || (currentRace(ctx.eventCard, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) === 0 }; if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-attribute:")) return { valuePredicate: (ctx) => !ctx.eventCard || (currentAttribute(ctx.eventCard, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) === 0 };
  if (effect.code === 344 && effect.label !== undefined) return { valueCardPredicate: (_ctx, card) => cardFieldId(card) === effect.label };
  if (effect.luaValueDescriptor !== "change-damage:effect-double" && effect.luaValueDescriptor !== "change-damage:effect-zero") return {};
  const applyValue = (ctx: Parameters<NonNullable<DuelEffectDefinition["lifePointValue"]>>[0], _player: PlayerId, amount: number): number => ((ctx.eventReason ?? 0) & duelReason.effect) !== 0 ? (effect.luaValueDescriptor === "change-damage:effect-double" ? amount * 2 : 0) : amount;
  return { battleDamageValue: applyValue, lifePointValue: applyValue };
}
function restoredLuaConditionCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "canActivate"> {
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) {
    return { canActivate: swordsOfRevealingLightPhaseEndCanActivate(effect) };
  }
  if (isKnownBookOfEclipsePhaseEndEffect(effect)) return { canActivate: bookOfEclipsePhaseEndCanActivate(effect) };
  if (isKnownMaharaghiPredrawEffect(effect)) return { canActivate: (ctx) => ctx.duel.turnPlayer === effect.controller && topDeckCards(ctx.duel, effect.controller).length > 0 };
  if (isKnownLevelNormalEndPhaseDestroyEffect(effect)) return { canActivate: levelNormalEndPhaseDestroyCanActivate(effect) };
  if (isKnownEngraverOfTheMarkDelayedDestroyEffect(effect)) return { canActivate: engraverOfTheMarkDelayedDestroyCanActivate(effect) };
  if (isKnownDelayedBattleDestroyPhaseEffect(effect)) {
    const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
    const markerCode = registryCode === undefined ? undefined : Number(registryCode);
    return {
      canActivate: (ctx) => markerCode !== undefined && ctx.duel.effects.some((candidate) => (
        candidate.event === "continuous" &&
        candidate.code === markerCode &&
        candidate.sourceUid !== undefined &&
        ctx.duel.cards.some((card) => card.uid === candidate.sourceUid && card.location === "monsterZone")
      )),
    };
  }
  const skipBattleCondition = temporarySelfTurnSkipBattlePhaseCanActivate(effect); if (skipBattleCondition) return { canActivate: skipBattleCondition };
  const skipMain1Condition = temporaryOpponentTurnSkipMain1CanActivate(effect); if (skipMain1Condition) return { canActivate: skipMain1Condition };
  const assaultZoneConditionCallbacks = assaultZoneReleaseFlagConditionCallbacks(effect);
  if (assaultZoneConditionCallbacks.canActivate) return assaultZoneConditionCallbacks;
  if (effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor) return { canActivate: (ctx) => ctx.source.controller === effect.controller };
  if (effect.luaConditionDescriptor === luaNotDrawPhaseConditionDescriptor) return { canActivate: (ctx) => ctx.duel.phase !== "draw" };
  if (effect.luaConditionDescriptor === luaSourceEquippedConditionDescriptor) return { canActivate: (ctx) => ctx.source.equippedToUid !== undefined };
  if (effect.luaConditionDescriptor === "condition:chain-solving-monster-effect-handler-original-code-label") return { canActivate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaConditionDescriptor === "condition:chain-solving-effect-handler-original-code-label") return { canActivate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:custom-activity-chain-count-at-least:")) return { canActivate: (ctx) => ctx.duel.activityHistory.filter((record) => record.player === effect.controller && record.activity === 0x20).length >= Number(effect.luaConditionDescriptor?.split(":").pop()) };
  if (effect.luaConditionDescriptor === "condition:damage-or-damage-calculation") return { canActivate: (ctx) => { const step = currentBattleStep(ctx.duel); return ctx.duel.phase === "battle" && (step === "damage" || step === "damageCalculation"); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:damage-source-relate-battle-target-faceup-attribute:")) return { canActivate: (ctx) => { const step = currentBattleStep(ctx.duel); const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.duel.phase === "battle" && (step === "damage" || step === "damageCalculation") && ctx.source.location === "monsterZone" && target?.faceUp === true && (currentAttribute(target, ctx.duel) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:controller-has-faceup-setcode:")) return { canActivate: (ctx) => { const setcode = Number(effect.luaConditionDescriptor?.split(":").pop()); return ctx.duel.cards.some((card) => card.controller === ctx.source.controller && card.location === "monsterZone" && card.faceUp === true && currentCardMatchesSetcode(card, ctx.duel, setcode)); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-own-faceup:")) return { canActivate: (ctx) => { const [, , kind, valuePart, , sourceLevelAbovePart] = effect.luaConditionDescriptor?.split(":") ?? []; const value = Number(valuePart), sourceLevelAbove = Number(sourceLevelAbovePart ?? 0); return Number.isSafeInteger(value) && Number.isSafeInteger(sourceLevelAbove) && currentLevel(ctx.source, ctx.duel) > sourceLevelAbove && hasZoneSpace(ctx.duel, ctx.source.controller, "monsterZone") && ctx.duel.cards.some((card) => card.controller === ctx.source.controller && card.location === "monsterZone" && card.faceUp && (kind === "attribute" ? (currentAttribute(card, ctx.duel) & value) !== 0 : kind === "code" ? currentCardMatchesCode(card, ctx.duel, String(value)) : kind === "level" ? currentLevel(card, ctx.duel) === value : false)); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-opponent-mzone-count-at-least:")) return { canActivate: (ctx) => { const [, , countPart, , sourceLevelAbovePart] = effect.luaConditionDescriptor?.split(":") ?? []; const requiredCount = Number(countPart), sourceLevelAbove = Number(sourceLevelAbovePart ?? 0); return Number.isSafeInteger(requiredCount) && Number.isSafeInteger(sourceLevelAbove) && currentLevel(ctx.source, ctx.duel) > sourceLevelAbove && hasZoneSpace(ctx.duel, ctx.source.controller, "monsterZone") && ctx.duel.cards.filter((card) => card.controller !== ctx.source.controller && card.location === "monsterZone").length >= requiredCount; } };
  if (effect.luaConditionDescriptor === "condition:source-faceup") return { canActivate: (ctx) => ctx.source.faceUp === true };
  if (effect.luaConditionDescriptor === "condition:gemini-status") return { canActivate: (ctx) => hasRestoredLuaGeminiStatus(ctx.duel, ctx.source) };
  if (effect.luaConditionDescriptor === "condition:source-attack-position") return { canActivate: (ctx) => ctx.source.position === "faceUpAttack" };
  if (effect.luaConditionDescriptor === "condition:source-defense-position") return { canActivate: (ctx) => ctx.source.position === "faceUpDefense" || ctx.source.position === "faceDownDefense" }; if (effect.luaConditionDescriptor === "condition:turn-player:self-main-phase") return { canActivate: (ctx) => (ctx.duel.phase === "main1" || ctx.duel.phase === "main2") && ctx.duel.turnPlayer === effect.controller }; if (effect.luaConditionDescriptor === "condition:turn-player:opponent-main-phase") return { canActivate: (ctx) => (ctx.duel.phase === "main1" || ctx.duel.phase === "main2") && ctx.duel.turnPlayer !== effect.controller }; if (effect.luaConditionDescriptor === "condition:turn-player:self-battle-phase") return { canActivate: (ctx) => ctx.duel.phase === "battle" && ctx.duel.turnPlayer === effect.controller }; if (effect.luaConditionDescriptor === "condition:turn-player:opponent-battle-phase") return { canActivate: (ctx) => ctx.duel.phase === "battle" && ctx.duel.turnPlayer !== effect.controller }; if (effect.luaConditionDescriptor?.startsWith("condition:turn-player-phase:")) return { canActivate: (ctx) => { const [, , side, mask] = effect.luaConditionDescriptor?.split(":") ?? []; const current = ctx.duel.phase === "draw" ? 1 : ctx.duel.phase === "standby" ? 2 : ctx.duel.phase === "main1" ? 4 : ctx.duel.phase === "battle" ? 128 : ctx.duel.phase === "main2" ? 256 : ctx.duel.phase === "end" ? 512 : 0; return current === Number(mask) && (side === "opponent" ? ctx.duel.turnPlayer !== effect.controller : ctx.duel.turnPlayer === effect.controller); } }; if (effect.luaConditionDescriptor?.startsWith("condition:phase:")) return { canActivate: (ctx) => (ctx.duel.phase === "draw" ? 1 : ctx.duel.phase === "standby" ? 2 : ctx.duel.phase === "main1" ? 4 : ctx.duel.phase === "battle" ? 128 : ctx.duel.phase === "main2" ? 256 : ctx.duel.phase === "end" ? 512 : 0) === Number(effect.luaConditionDescriptor?.split(":").pop()) }; if (effect.luaConditionDescriptor === "condition:battle-phase") return { canActivate: (ctx) => ctx.duel.phase === "battle" }; if (effect.luaConditionDescriptor === "condition:main-phase") return { canActivate: (ctx) => ctx.duel.phase === "main1" || ctx.duel.phase === "main2" }; if (effect.luaConditionDescriptor === "condition:main-or-battle-phase") return { canActivate: (ctx) => ctx.duel.phase === "main1" || ctx.duel.phase === "main2" || ctx.duel.phase === "battle" }; if (effect.luaConditionDescriptor === "condition:turn-player:self") return { canActivate: (ctx) => ctx.duel.turnPlayer === effect.controller }; if (effect.luaConditionDescriptor === "condition:turn-player:opponent") return { canActivate: (ctx) => ctx.duel.turnPlayer !== effect.controller };
  if (effect.luaConditionDescriptor?.startsWith("condition:equipped-target-setcode:")) return { canActivate: (ctx) => { const setcode = Number(effect.luaConditionDescriptor?.split(":").pop()); const equippedTarget = ctx.duel.cards.find((card) => card.uid === ctx.source.equippedToUid); return Boolean(equippedTarget && currentCardMatchesSetcode(equippedTarget, ctx.duel, setcode)); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:equipped-target-type:")) return { canActivate: (ctx) => { const type = Number(effect.luaConditionDescriptor?.split(":").pop()); const equippedTarget = ctx.duel.cards.find((card) => card.uid === ctx.source.equippedToUid); return Boolean(equippedTarget && (cardTypeFlags(equippedTarget, ctx.duel) & type) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:equipped-target-race:")) return { canActivate: (ctx) => { const race = Number(effect.luaConditionDescriptor?.split(":").pop()); const equippedTarget = ctx.duel.cards.find((card) => card.uid === ctx.source.equippedToUid); return Boolean(equippedTarget && (currentRace(equippedTarget, ctx.duel) & race) !== 0); } };
  if (effect.luaConditionDescriptor === "condition:source-relate-battle-target-monster") return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.source.location === "monsterZone" && target && (cardTypeFlags(target, ctx.duel) & 0x1) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-battle-target-opponent-previous-location-reason-player:")) return { canActivate: (ctx) => { const [, , location, reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); const reasonPlayer = side === "opponent" ? otherPlayer(effect.controller) : effect.controller; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0 && (ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller) === reasonPlayer && target && target.controller !== effect.controller); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return locationMatchesCardMask(ctx.source, Number(location)) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-location-not:")) return { canActivate: (ctx) => !locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop())) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-location:")) return { canActivate: (ctx) => locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop())) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-turn-current-reason-not:")) return { canActivate: (ctx) => ctx.source.turnId === ctx.duel.turn && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(effect.luaConditionDescriptor?.split(":").pop())) === 0 }; if (effect.luaConditionDescriptor === "condition:source-turn-current") return { canActivate: (ctx) => ctx.source.turnId === ctx.duel.turn }; if (effect.luaConditionDescriptor === "condition:source-turn-not-current") return { canActivate: (ctx) => ctx.source.turnId !== ctx.duel.turn }; if (effect.luaConditionDescriptor === "condition:source-turn-next") return { canActivate: (ctx) => ctx.source.turnId !== undefined && ctx.source.turnId + 1 === ctx.duel.turn }; if (effect.luaConditionDescriptor?.startsWith("condition:source-battle-target-race-source-location:")) return { canActivate: (ctx) => { const [, , race, location] = effect.luaConditionDescriptor?.split(":") ?? []; const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(locationMatchesCardMask(ctx.source, Number(location)) && target && (currentRace(target, ctx.duel) & Number(race)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-battle-target-race:")) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.source.location === "monsterZone" && target && (currentRace(target, ctx.duel) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-battle-target-attribute:")) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.source.location === "monsterZone" && target && (currentAttribute(target, ctx.duel) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-relate-battle-target-reason:")) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); const reason = ctx.eventCard?.uid === target?.uid ? ctx.eventReason ?? target?.reason ?? 0 : target?.reason ?? 0; return Boolean(ctx.source.location === "monsterZone" && target && (reason & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0); } }; if (effect.luaConditionDescriptor === "condition:damage-source-relate-battle-target" || effect.luaConditionDescriptor === "condition:source-battle-target") return { canActivate: (ctx) => { const step = currentBattleStep(ctx.duel); const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; return Boolean((effect.luaConditionDescriptor !== "condition:damage-source-relate-battle-target" || ctx.duel.phase === "battle" && (step === "damage" || step === "damageCalculation")) && ctx.source.location === "monsterZone" && (ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined)); } }; if (effect.luaConditionDescriptor === "condition:source-battle-target-opponent") return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.source.location === "monsterZone" && target && target.controller !== ctx.player); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-status-summon-type:")) return { canActivate: (ctx) => { const [, , statusMask, typeMask] = effect.luaConditionDescriptor?.split(":") ?? []; const status = (ctx.source.customStatusMask ?? 0) | (ctx.source.summonType === "normal" || ctx.source.summonType === "tribute" ? 0x800 : 0) | (ctx.source.summonType === "flip" ? 0x20000000 : 0) | (ctx.source.summonType && ctx.source.summonType !== "normal" && ctx.source.summonType !== "tribute" && ctx.source.summonType !== "flip" ? 0x40000000 : 0) | (((ctx.source.reason ?? 0) & duelReason.battle) !== 0 ? 0x4000 : 0); return (status & Number(statusMask)) !== 0 && isSummonTypeMaskMatch(summonTypeMaskFromCard(ctx.source), Number(typeMask)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-status-battle-target-control:")) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const related = Boolean(ctx.source.location === "monsterZone" && (battle?.attackerUid === ctx.source.uid || battle?.targetUid === ctx.source.uid)); const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); const status = (ctx.source.customStatusMask ?? 0) | (related && battle?.targetUid ? 0x10000000 : 0); return Boolean(related && target && (status & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0 && target.controller !== otherPlayer(target.controller) && (target.location === "monsterZone" || target.location === "spellTrapZone") && !isControlChangePrevented(ctx.duel, target, createLuaMaterialCheckContext(ctx.duel)) && hasZoneSpace(ctx.duel, otherPlayer(target.controller), target.location)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-status-relate-battle:")) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const related = Boolean(ctx.source.location === "monsterZone" && (battle?.attackerUid === ctx.source.uid || battle?.targetUid === ctx.source.uid)); const status = (ctx.source.customStatusMask ?? 0) | (ctx.source.summonType === "normal" || ctx.source.summonType === "tribute" ? 0x800 : 0) | (ctx.source.summonType === "flip" ? 0x20000000 : 0) | (ctx.source.summonType && ctx.source.summonType !== "normal" && ctx.source.summonType !== "tribute" && ctx.source.summonType !== "flip" ? 0x40000000 : 0) | (((ctx.source.reason ?? 0) & duelReason.battle) !== 0 ? 0x4000 : 0) | (related && battle?.targetUid ? 0x10000000 : 0); return related && (status & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-status-not:")) return { canActivate: (ctx) => { const mask = Number(effect.luaConditionDescriptor?.split(":").pop()); const status = (ctx.source.customStatusMask ?? 0) | (ctx.source.summonType === "normal" || ctx.source.summonType === "tribute" ? 0x800 : 0) | (ctx.source.summonType === "flip" ? 0x20000000 : 0) | (ctx.source.summonType && ctx.source.summonType !== "normal" && ctx.source.summonType !== "tribute" && ctx.source.summonType !== "flip" ? 0x40000000 : 0) | (((ctx.source.reason ?? 0) & duelReason.battle) !== 0 ? 0x4000 : 0); return (status & mask) === 0; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-status:")) return { canActivate: (ctx) => { const mask = Number(effect.luaConditionDescriptor?.split(":").pop()); const status = (ctx.source.customStatusMask ?? 0) | (ctx.source.summonType === "normal" || ctx.source.summonType === "tribute" ? 0x800 : 0) | (ctx.source.summonType === "flip" ? 0x20000000 : 0) | (ctx.source.summonType && ctx.source.summonType !== "normal" && ctx.source.summonType !== "tribute" && ctx.source.summonType !== "flip" ? 0x40000000 : 0) | (((ctx.source.reason ?? 0) & duelReason.battle) !== 0 ? 0x4000 : 0); return (status & mask) !== 0; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-summon-type:")) return { canActivate: (ctx) => isSummonTypeMaskMatch(summonTypeMaskFromCard(ctx.source), Number(effect.luaConditionDescriptor?.split(":").pop())) };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-summon-location:")) return { canActivate: (ctx) => Boolean(ctx.source.summonType && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-not:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) === 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all-player:")) return { canActivate: (ctx) => { const [, , location, reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const mask = Number(reason); const sourceReason = (ctx.eventReason ?? ctx.source.reason) ?? 0; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (sourceReason & mask) === mask && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; const mask = Number(reason); return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & mask) === mask); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location:")) return { canActivate: (ctx) => Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason-player-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0 && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-position:")) return { canActivate: (ctx) => { const [, , previous, current] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(previous)) !== 0 && (positionMaskFromPosition(ctx.source.position) & Number(current)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && locationMatchesCardMask(ctx.source, Number(location)) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location:")) return { canActivate: (ctx) => { const [, , position, location] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-reason:")) return { canActivate: (ctx) => { const [, , position, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position:")) return { canActivate: (ctx) => Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0) };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && locationMatchesCardMask(ctx.source, Number(location)) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-side-previous-location:")) return { canActivate: (ctx) => { const [, , location, side] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller) && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason-player:")) return { canActivate: (ctx) => { const [, , location, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location:")) return { canActivate: (ctx) => Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-reason-player-reason:")) return { canActivate: (ctx) => { const [, , reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return ctx.source.previousController === effect.controller && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0; } }; if (effect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent") return { canActivate: (ctx) => { const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return ctx.source.previousController === effect.controller && reasonPlayer === otherPlayer(effect.controller); } }; if (effect.luaConditionDescriptor === "condition:source-previous-controller") return { canActivate: (ctx) => ctx.source.previousController === effect.controller };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-not:")) return { canActivate: (ctx) => ((ctx.eventReason ?? ctx.source.reason ?? 0) & Number(effect.luaConditionDescriptor?.split(":").pop())) === 0 }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-all:")) return { canActivate: (ctx) => { const mask = Number(effect.luaConditionDescriptor?.split(":").pop()); return ((ctx.eventReason ?? ctx.source.reason ?? 0) & mask) === mask; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason:")) return { canActivate: (ctx) => ((ctx.eventReason ?? ctx.source.reason ?? 0) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0 }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-player:")) return { canActivate: (ctx) => (ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller) === (effect.luaConditionDescriptor?.endsWith(":opponent") === true ? otherPlayer(effect.controller) : effect.controller) };
  if (effect.luaConditionDescriptor === "condition:source-overlay-count-positive") return { canActivate: (ctx) => ctx.source.overlayUids.length > 0 }; if (effect.luaConditionDescriptor === "condition:source-overlay-count-zero") return { canActivate: (ctx) => ctx.source.overlayUids.length === 0 };
  return {};
}
function restoredLuaCostCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "cost"> { const summonTypeNot = specialSummonTypeNotCostDescriptor(effect.luaCostDescriptor); const summonTypeIs = specialSummonTypeIsCostDescriptor(effect.luaCostDescriptor); if (summonTypeNot !== undefined) return { cost: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== summonTypeNot }; return summonTypeIs === undefined ? {} : { cost: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === summonTypeIs }; }
function hasRestoredLuaGeminiStatus(duel: DuelSession["state"], card: DuelCardInstance): boolean {
  return (
    card.location === "monsterZone" &&
    ((card.faceUp && isSummonTypeMaskMatch(card.summonTypeCode ?? 0, luaSummonTypeGemini) && locationMatchesCardMask(card, luaLocationMonsterZone, card.previousLocation, card.previousSequence))
      || duel.effects.some((candidate) => candidate.code === luaEffectGeminiStatus && candidate.sourceUid === card.uid))
  );
}
function topDeckCards(state: DuelSession["state"], player: PlayerId): DuelCardDefinitionLike[] { return state.cards.filter((card) => card.controller === player && card.location === "deck").sort((a, b) => a.sequence - b.sequence); }
type DuelCardDefinitionLike = DuelSession["state"]["cards"][number];
function luaReasonPredicateMask(descriptor: string | undefined): number | undefined {
  if (descriptor === luaEffectReasonPredicateDescriptor) return duelReason.effect;
  if (!descriptor?.startsWith(luaReasonMaskPredicateDescriptorPrefix)) return undefined;
  const mask = Number(descriptor.slice(luaReasonMaskPredicateDescriptorPrefix.length));
  return Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}
function relatedEffectIsContinuous(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): boolean {
  const relatedEffect = relatedEffectFromContext(ctx);
  return ((relatedEffect?.luaTypeFlags ?? 0) & 0x800) !== 0;
}
function relatedEffectIsSpecialSummonedMonsterOnField(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): boolean {
  const relatedEffect = relatedEffectFromContext(ctx);
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
function relatedEffectIsNonSpiritMonsterEffect(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): boolean {
  const relatedEffect = relatedEffectFromContext(ctx);
  const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
  const typeFlags = cardTypeFlags(handler, ctx.duel);
  return Boolean(handler && (typeFlags & luaTypeMonster) !== 0 && (typeFlags & luaTypeSpirit) === 0);
}
function relatedEffectFromContext(ctx: Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0]): DuelEffectDefinition | undefined {
  const relatedEffectId = ctx.relatedEffectId === undefined ? ctx.chainLink?.effectId : `lua-${ctx.relatedEffectId}`;
  return ctx.duel.effects.find((effect) => effect.id === relatedEffectId || (relatedEffectId !== undefined && effect.id.startsWith(`${relatedEffectId}-`)));
}
function cardLocationMask(location: DuelEffectContext["source"]["location"] | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  return 0;
}
function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
function luaScriptRegistryKeys(registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): Set<string> {
  const knownRestorableKeys = new Set(
    snapshotEffects
      .filter((effect) => isKnownRestorableLuaEffect(effect, snapshotEffects))
      .map((effect) => effect.registryKey)
      .filter((key): key is string => Boolean(key)),
  );
  return new Set([...registryKeys].filter((key) => !knownRestorableKeys.has(key)));
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> { return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:")))); }
function luaRestoreIncompleteReasons(loadedScripts: LuaScriptLoadResult[], missingRegistryKeys: string[], missingChainLimitRegistryKeys: string[]): string[] {
  return [
    ...loadedScripts.filter((result) => !result.ok).map((result) => `script ${result.name}: ${result.error}`),
    ...(missingRegistryKeys.length === 0 ? [] : [`missing Lua effect registry keys: ${missingRegistryKeys.join(", ")}`]),
    ...(missingChainLimitRegistryKeys.length === 0 ? [] : [`missing Lua chain-limit registry keys: ${missingChainLimitRegistryKeys.join(", ")}`]),
  ];
}
function luaRestoreIncompleteError(restored: LuaSnapshotRestoreResult): string { return restored.incompleteReasons.length === 0 ? "Lua snapshot restore is incomplete" : `Lua snapshot restore is incomplete: ${restored.incompleteReasons.join("; ")}`; }
