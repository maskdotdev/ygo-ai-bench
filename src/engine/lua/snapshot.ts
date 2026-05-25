import { findCard, hasZoneSpace, pushDuelLog } from "#duel/card-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttack, currentAttackWithoutEffect, currentAttribute, currentLevel, currentRace } from "#duel/card-stats.js";
import { addDuelChainLimit, applyResponse, banishDuelCard, canMoveDuelCardToLocation, canPlayerSpecialSummon, collectDuelGroupedTriggerEffects, collectDuelTriggerEffects, collectDuelTriggerEvent, damageDuelPlayer, destroyDuelCard, detachDuelOverlayMaterials, drawDuelCards, getGroupedDuelLegalActions, getLegalActions, moveDuelCardWithRedirects, queryPublicState, recoverDuelPlayer, sendDuelCardToGraveyard } from "#duel/core.js"; import { isControlChangePrevented } from "#duel/continuous-effects.js"; import { currentBattleStep } from "#duel/battle-window-state.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import { effectiveSpecialSummonTypeCode, isSummonTypeMaskMatch, luaSummonTypeRitual, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { cardFieldId } from "#duel/card-field-id.js";
import { bookOfEclipsePhaseEndCanActivate, bookOfEclipsePhaseEndOperation, isKnownBookOfEclipsePhaseEndEffect } from "#lua/snapshot-book-of-eclipse.js";
import { delayedFlaggedSendToHandOperation, delayedGroupSendToHandOperation, engraverOfTheMarkDelayedDestroyCanActivate, engraverOfTheMarkDelayedDestroyOperation, isKnownDelayedGroupSendToHandEffect, isKnownDelayedSendToHandEffect, isKnownEngraverOfTheMarkDelayedDestroyEffect, isKnownLimiterRemovalDelayedDestroyEffect, isKnownPurushaddollAeonDelayedFlipEffect, isKnownRagingMadPlantsDelayedDestroyEffect, isKnownTemporaryBanishReturnToFieldEffect, isKnownTsumuhaKutsunagiDelayedShuffleEffect, isKnownUnleashYourPowerDelayedSetEffect, isKnownWakeCupMochaDelayedSendToGraveEffect, isKnownYellowAlertDelayedReturnEffect, limiterRemovalDelayedDestroyOperation, purushaddollAeonDelayedFlipCanActivate, purushaddollAeonDelayedFlipOperation, ragingMadPlantsDelayedDestroyOperation, temporaryBanishReturnToFieldCanActivate, temporaryBanishReturnToFieldOperation, tsumuhaKutsunagiDelayedShuffleOperation, unleashYourPowerDelayedSetOperation, wakeCupMochaDelayedSendToGraveOperation, yellowAlertDelayedReturnOperation } from "#lua/snapshot-delayed-operations.js";
import { delayedBattleDestroyPhaseCanActivate, delayedBattleDestroyPhaseOperation, isKnownDelayedBattleDestroyMarkerEffect, isKnownDelayedBattleDestroyPhaseEffect } from "#lua/snapshot-delayed-battle-destroy.js";
import { luaHandlerDestroyOperation, luaLinkedLeaveFieldDestroyOperation } from "#lua/snapshot-destroy-operations.js";
import { isKnownLevelNormalEndPhaseDestroyEffect, levelNormalEndPhaseDestroyCanActivate, levelNormalEndPhaseDestroyOperation } from "#lua/snapshot-level-normal-end-phase-destroy.js";
import { isKnownSelfEndPhaseBanishEffect, isKnownSelfEndPhaseDestroyEffect, isKnownSelfEndPhaseReturnToHandEffect, isKnownSelfEndPhaseSendEffect, selfEndPhaseBanishOperation, selfEndPhaseDestroyOperation, selfEndPhaseReturnToHandOperation, selfEndPhaseSendOperation } from "#lua/snapshot-self-end-phase-destroy.js";
import { isKnownSwordsOfRevealingLightPhaseEndEffect, isKnownSwordsOfRevealingLightResetEffect, swordsOfRevealingLightPhaseEndCanActivate, swordsOfRevealingLightPhaseEndOperation, swordsOfRevealingLightRestoredReset } from "#lua/snapshot-swords-of-revealing-light.js";
import { isKnownPlayerDamageZeroEffect, isKnownStaticForbiddenCardEffect, isKnownTemporaryActivationLockEffect, isKnownTemporaryArtifactLanceaBanishLockEffect, isKnownTemporaryAttackAnnounceLabelObjectWatcherEffect, isKnownTemporaryAttackAnnounceNegateEffect, isKnownTemporaryBattleProtectionEffect, isKnownTemporaryBattledSetAttackFinalWatcherEffect, isKnownTemporaryCannotAttackAnnounceSelfEffect, isKnownTemporaryCannotAttackEffect, isKnownTemporaryCannotDirectAttackEffect, isKnownTemporaryDirectAttackEffect, isKnownTemporaryEarthshatteringDeckGraveLockEffect, isKnownTemporaryFieldIdAttackAnnounceLockEffect, isKnownTemporaryForbiddenCardEffect, isKnownTemporaryMonsterAttackAllEffect, isKnownTemporaryMonsterBattleDamageAvoidEffect, isKnownTemporaryMonsterExtraAttackEffect, isKnownTemporaryMonsterNoBattleDamageEffect, isKnownTemporaryOpponentCannotBattlePhaseEffect, isKnownTemporaryOpponentTurnSkipMain1Effect, isKnownTemporaryOpponentTurnSkipMain2Effect, isKnownTemporaryOpponentTurnSkipTurnEffect, isKnownTemporaryPlayerAttackAnnounceLockEffect, isKnownTemporaryPlayerHalfBattleDamageEffect, isKnownTemporarySameCodeActivationOathEffect, isKnownTemporarySelfTurnCannotEndPhaseEffect, isKnownTemporarySelfTurnSkipBattlePhaseEffect, isKnownTemporarySetcodeAttackAnnounceLockEffect, isKnownTemporarySummonSetLockEffect, isKnownTemporaryTypeTargetAttackUpdateEffect, temporaryAttackAnnounceLabelObjectWatcherOperation, temporaryAttackAnnounceNegateOperation, temporaryBattledSetAttackFinalWatcherOperation, temporaryOpponentTurnSkipMain1CanActivate, temporarySelfTurnSkipBattlePhaseCanActivate } from "#lua/snapshot-temporary-effects.js";
import { isKnownMulcharmyDrawWatcherEffect, isKnownMulcharmyEndPhaseShuffleEffect, mulcharmyDrawWatcherOperation, mulcharmyEndPhaseShuffleOperation } from "#lua/snapshot-mulcharmy.js";
import { alchemyCycleBattleDestroyedDrawConditionCallbacks, alchemyCycleBattleDestroyedDrawOperation, isKnownAlchemyCycleBattleDestroyedDrawEffect } from "#lua/snapshot-alchemy-cycle.js";
import { assaultZoneExtraDeckReleaseValueCallbacks, assaultZoneReleaseFlagConditionCallbacks, assaultZoneReleaseFlagOperation, isAssaultZoneExtraDeckReleaseRestoreEffect } from "#lua/snapshot-assault-zone.js"; import { assaultSpiritsDamageStepEquipCondition, assaultSpiritsDamageStepEquipCost, assaultSpiritsDamageStepEquipOperation, isKnownAssaultSpiritsDamageStepEquipEffect } from "#lua/snapshot-assault-spirits.js";
import { calledByTheGraveChainSolvingNegateOperation, gishkiEmiliaTrapNegateOperation, isKnownCalledByTheGraveChainSolvingNegateEffect, isKnownGishkiEmiliaTrapNegateEffect, isKnownRareMetalmorphChainSolvingNegateEffect, isKnownSameOriginalCodeChainSolvingNegateEffect, isKnownWorldLegacyWhispersSpellNegateEffect, rareMetalmorphChainSolvingNegateOperation, worldLegacyWhispersSpellNegateOperation } from "#lua/snapshot-chain-solving-effects.js";
import { luaChainLimitRegistryKeys, luaDenyChainLimitRegistry, restoreKnownLuaChainLimits } from "#lua/snapshot-chain-limits.js";
import { isKnownSunlitSentinelDelayedStandbyEffect, sunlitSentinelDelayedStandbyOperation } from "#lua/snapshot-sunlit-sentinel.js";
import { isKnownDoubleSnareValidityEffect, isKnownTrapMonsterDisableEffect, isStaticPlayerPhaseLock } from "#lua/snapshot-static-effects.js";
import { isKnownCannotActivateLocationMonsterEffect, isKnownCannotActivateNonSpiritMonsterEffect, isKnownCannotActivateSpecialSummonedMonsterEffect, isKnownCannotBeMaterialEffect, isKnownCannotSelectBattleTargetNotHandlerEffect, isKnownGeminiEndPhaseReturnEffect, isKnownGeminiStatusEffect, isKnownGrantedSpiritEndPhaseReturnEffect, isKnownRemainFieldEffect, isKnownSetcodeOrCodeTypeBattleProtectionEffect, isKnownSpiritAddTypeEffect, isKnownTemporaryCannotTriggerEffect, isKnownTemporaryTunerAddTypeEffect } from "#lua/snapshot-restorable-effect-predicates.js";
import { gagagaGirlXyzAttackZeroOperation, isKnownGagagaGirlXyzAttackZeroTriggerEffect, isKnownXyzMaterialAttackGainTriggerEffect, isKnownXyzMaterialEffectAddType, xyzMaterialAttackGainOperation } from "#lua/snapshot-xyz-material-gain.js";
import { luaRegistryCardCodes } from "#lua/snapshot-registry-keys.js";
import { restoredSpecialSummonConditionValueCallbacks } from "#lua/snapshot-special-summon-condition.js";
import { isLuaOptionPromptDecision, isLuaYesNoPromptDecision, type LuaPromptOverride } from "#lua/host-types.js";
import { ritualSummonSelectedMaterials, type LuaDuelSummonApiHostState } from "#lua/duel-api/summon.js";
import { linkedGroupUidsForCard } from "#lua/duel-api/location.js";
import { luaTemporaryControlReturnDescriptor, luaTemporaryControlReturnOperation } from "#lua/duel-api/move-control.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import { specialSummonTypeIsCostDescriptor, specialSummonTypeNotCostDescriptor } from "#lua/effect-cost-descriptor.js";
import { luaValueDescriptorStatValue } from "#lua/effect-value-descriptor-callbacks.js";
import { locationMatchesCardMask, positionMaskFromPosition } from "#lua/api-utils.js"; import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { notSetcodeTargetDescriptor, restoredLuaTargetCallbacks, setcodeOrCodeTypeTargetDescriptor, setcodeTargetDescriptor, typeTargetDescriptor } from "#lua/snapshot-target-callbacks.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, ChainLink, DuelAction, DuelCardInstance, DuelCardReader, DuelEffectContext, DuelEffectDefinition, DuelResponse, DuelSession, PendingTrigger, PlayerId, SerializedDuel, SerializedDuelEffect } from "#duel/types.js";
const luaEffectEquipLimit = 76;
const luaEffectGeminiStatus = 75;
const luaEffectAddType = 115;
const luaEffectRemainField = 17;
const luaEffectUnionStatus = 347;
const luaEffectOldUnionStatus = 348;
const luaEffectClockLizard = 51476410;
const luaEffectPierce = 203;
const luaPhotonTridentCode = 51589188;
const luaCategoryDestroy = 0x1;
const luaEventBattleDamage = 1143;
const luaEffectIndestructibleEffect = 41;
const luaEffectIndestructibleBattle = 42;
const luaEffectForceMonsterZone = 265;
const luaEffectFlagSingleRange = 0x20000;
const luaEffectFlagClientHint = 0x4000000;
const luaEffectFlagPlayerTarget = 0x800;
const luaEffectFlagOwnerRelate = 0x1000000;
const luaReinforceCode = "71948047";
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
const luaMaharaghiCode = "40695128"; const luaHinoKaguTsuchiCode = "75745607"; const luaGreatLongNoseCode = "2356994";
const luaXxSaberDarksoulCode = "31383545"; const luaDragodiesCode = "65472618"; const luaPerformapalCelestialMagicianCode = "58092907";
const luaFamiliarPossessedDharcCode = "21390858"; const luaDarkMagicExpandedCode = "111280";
const luaEucalyptusMoleCode = "71228611";
const luaWattcubeCode = "65612454";
const luaBattleguardRageCode = "42233477";
const luaEbonArrowCode = "88341502"; const luaDivineEvolutionCode = "7373632";
const luaByeByeDamageCode = "20735371";
const luaMirrorWallCode = "22359980";
const luaDoubleOrNothingCode = "94770493";
const luaMagnificentMachineAngelCode = "27331568";
const luaOverdoomLineCode = "87046457";
const luaMiniGutsCode = "99004752"; const luaUradoraOfFateCode = "27753563";
const luaMermailAbyssbalaenCode = "75180828"; const luaTimeTearingMorganiteCode = "19403423";
const luaSpellbookOfPowerCode = "25123082"; const luaEvolsaurCeratoCode = "80651316";
const luaUtopiaEnvoyCode = "76504386";
const luaShiranuiSamuraiCode = "35818851";
const luaCommonSoulCode = "14772491";
const luaClashingSoulsCode = "57496978";
const luaSagaDragonEmperorCode = "66156348";
const luaMachineKing3000BcCode = "70406920";
const luaArcanaForceHierophantCode = "3376703";
const luaArcanaForceChariotCode = "34568403";
const luaArcanaForceMoonCode = "97452817";
const luaBlazeCannonCode = "4059313"; const luaPenetrationFusionCode = "8778267"; const luaBattlinBoxerLeadYokeCode = "23232295"; const luaParticleFusionCode = "39261576"; const luaGauntletWarriorCode = "79337169";
const luaMegalithUnformedCode = "69003792"; const luaDaiDanceCode = "50696588"; const luaExosisterCarpedivemCode = "30802207";
const luaMetaphysRagnarokCode = "19476824";
const luaEndPhaseReviveDestroyCodes = new Set(["32061744", "37745919", "46874015"]);
const luaDinowrestlerMartialAnkyloCode = "35770983";
const luaLeaveFieldLinkedDestroyCodes = new Set(["29013526", "29139104", "56524813"]);
const luaSetMegalith = 0x138;
const luaSetSpellbook = 0x106e; const luaSetEvoltile = 0x304e;
const luaCategorySpecialSummon = 0x200; const luaCategoryToken = 0x400; const luaCategoryControl = 0x2000; const luaLocationDeck = 0x1;
const luaSummonTypeGemini = 0x12000000; const luaLocationMonsterZone = 0x4; const luaLocationExtraDeck = 0x40;
const luaTypeMonster = 0x1; const luaTypeSpell = 0x2; const luaTypeRitual = 0x80; const luaTypeSpirit = 0x200; const luaTypeTuner = 0x1000;
const luaRaceFiend = 0x8; const luaRaceMachine = 0x200;
const luaCategoryAtkChange = 0x200000;
const luaResetEvent = 0x1000; const luaResetChain = 0x80000000; const luaResetTurnSet = 0x20000;
const luaResetPhase = 0x40000000; const luaResetOpponentTurn = 0x20000000;
const luaPhaseBattle = 0x80; const luaPhaseStandby = 0x2; const luaPhaseEnd = 0x200;
const luaBattlePhaseEventCode = luaResetEvent | luaPhaseBattle; const luaPhaseStandbyEventCode = luaResetEvent | luaPhaseStandby; const luaPhaseEndEventCode = luaResetEvent | luaPhaseEnd;
const luaHalfDamage = 0x80000001;
const luaResetsStandardPhaseEnd = 0x41fe1200;
const luaResetsStandardPhaseEndRuntime = luaResetsStandardPhaseEnd & ~luaResetEvent;
const luaResetEventStandard = luaResetEvent | 0x1fe0000;
const luaPhaseEndResetFlags = luaResetPhase | luaPhaseEnd;
const luaPhaseDamageResetFlags = luaResetPhase | 0x20;
const luaTemporaryRestrictionResetFlags = luaResetsStandardPhaseEnd & ~luaResetTurnSet; const luaTemporaryPositionLockResetFlags = luaResetPhase | luaPhaseEnd;
const luaOpponentTurnPhaseEndResetFlags = luaTemporaryPositionLockResetFlags | luaResetOpponentTurn;
const luaResetsStandardOpponentPhaseEnd = luaResetsStandardPhaseEnd | luaResetOpponentTurn;
const luaTemporaryRestrictionOpponentResetFlags = luaTemporaryRestrictionResetFlags | luaResetOpponentTurn;
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
  options: { promptOverrides?: LuaPromptOverride[] } = {},
): LuaSnapshotRestoreResult {
  const chainLimitRegistryKeys = luaChainLimitRegistryKeys(snapshot);
  const session = restoreDuel(snapshot, cardReader, {}, luaDenyChainLimitRegistry(chainLimitRegistryKeys), { pruneUnrestoredPendingTriggers: false });
  session.state.actionWindowToken = createActionWindowToken();
  const host = createLuaScriptHost(session, undefined, {
    reuseExistingLuaEffectIds: true,
    ...(options.promptOverrides === undefined ? {} : { promptOverrides: options.promptOverrides }),
  });
  const registryKeys = luaRegistryKeys(snapshot);
  const scriptRegistryKeys = luaScriptRegistryKeys(registryKeys, snapshot.state.effects, source);
  const loadedScripts = [...luaRegistryCardCodes(scriptRegistryKeys, chainLimitRegistryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  if (loadedScripts.every((result) => result.ok)) loadAvailableCardMetadataScripts(host, source, snapshot.state.cards.map((card) => card.code), loadedScripts);
  if (loadedScripts.every((result) => result.ok)) restoreLuaHostEffectMetadata(host, snapshot.state.effects);
  const restoredStateScripts = loadedScripts.every((result) => result.ok) ? restoreKnownLuaStateEffects(session, host, registryKeys, snapshot.state.effects) : [];
  restoreKnownLuaChainLimits(session, host, chainLimitRegistryKeys);
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys, snapshot.state.effects);
  restoredRegistryKeys.push(...restoreKnownLuaEffects(session, registryKeys, snapshot.state.effects, restoredRegistryKeys));
  restoredRegistryKeys.push(...restoreDoubleOrNothingBattleStartEffects(session, snapshot.state.effects, restoredRegistryKeys));
  restoredRegistryKeys.push(...restoreMagnificentMachineAngelBattleStartDisableEffects(session, snapshot.state.effects, restoredRegistryKeys));
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

function loadAvailableCardMetadataScripts(host: LuaScriptHost, source: LuaScriptSource, cardCodes: string[], loadedScripts: LuaScriptLoadResult[]): void {
  const loaded = new Set(loadedScripts.filter((result) => result.ok).map((result) => result.name));
  for (const code of new Set(cardCodes)) {
    const name = `c${code}.lua`;
    if (loaded.has(name) || !cardMetadataScriptExists(source, name)) continue;
    const result = host.loadCardScript(Number(code), source);
    if (result.ok) loaded.add(name);
  }
}

function cardMetadataScriptExists(source: LuaScriptSource, name: string): boolean {
  try {
    return source.readScript(name) !== undefined;
  } catch {
    return false;
  }
}

function restoreLuaHostEffectMetadata(host: LuaScriptHost, snapshotEffects: SerializedDuelEffect[]): void {
  for (const effect of snapshotEffects) {
    if (!effect.registryKey?.startsWith("lua:")) continue;
    host.restoreEffectMetadata(effect.registryKey, {
      ...(effect.label === undefined ? {} : { label: effect.label }),
      ...(effect.labels === undefined ? {} : { labels: [...effect.labels] }),
      ...(effect.labelObjectId === undefined ? {} : { labelObjectId: effect.labelObjectId }),
      ...(effect.labelObjectUid === undefined ? {} : { labelObjectUid: effect.labelObjectUid }),
      ...(effect.labelObjectUids === undefined ? {} : { labelObjectUids: [...effect.labelObjectUids] }),
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
  restoreMaterialCheckTriggers(restored, response);
  return drainRestoredLuaOperationPrompts(restored, refreshedLuaResponse(restored, result));
}

function refreshedLuaResponse(restored: LuaSnapshotRestoreResult, result: ApplyDuelResponseResult): ApplyDuelResponseResult {
  if (!result.ok) return result;
  const waitingFor = restored.session.state.waitingFor;
  const legalActions = waitingFor === undefined ? [] : getLuaRestoreLegalActions(restored, waitingFor);
  const legalActionGroups = waitingFor === undefined ? [] : getLuaRestoreLegalActionGroups(restored, waitingFor);
  return { ...result, state: queryPublicState(restored.session), legalActions, legalActionGroups };
}

function restoreMaterialCheckTriggers(restored: LuaSnapshotRestoreResult, response: DuelResponse): void {
  if (response.type !== "fusionSummon" && response.type !== "synchroSummon" && response.type !== "xyzSummon" && response.type !== "tributeSummon") return;
  const source = restored.session.state.cards.find((card) => card.uid === response.uid);
  if (!source) return;
  const materialCheckEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === source.uid && effect.code === 251);
  if (materialCheckEffects.length === 0) return;
  const before = new Set(restored.session.state.pendingTriggers.map(pendingTriggerKey));
  for (const effect of materialCheckEffects) {
    const checked = restored.host.runMaterialCheck(effect.id, source.uid, response.player);
    if (!checked.ok) pushDuelLog(restored.session.state, "luaMaterialCheck", response.player, source.name, checked.error ?? "Lua material check failed");
  }
  const eventName = response.type === "tributeSummon" ? "normalSummoned" : "specialSummoned";
  const event = [...restored.session.state.eventHistory].reverse().find((candidate) => candidate.eventName === eventName && candidate.eventCardUid === source.uid);
  const historyBefore = restored.session.state.eventHistory.length;
  collectDuelTriggerEvent(restored.session.state, eventName, source, event ? eventPayloadFromHistory(event) : undefined);
  if (event) restored.session.state.eventHistory.splice(historyBefore);
  restored.session.state.pendingTriggers = restored.session.state.pendingTriggers.filter((trigger, index, triggers) => {
    const key = pendingTriggerKey(trigger);
    return !before.has(key) || triggers.findIndex((candidate) => pendingTriggerKey(candidate) === key) === index;
  });
}

function pendingTriggerKey(trigger: PendingTrigger): string {
  return [trigger.effectId, trigger.sourceUid, trigger.eventName, trigger.eventCardUid, trigger.eventCode, trigger.eventReason, trigger.eventReasonCardUid].join("|");
}

function eventPayloadFromHistory(event: DuelSession["state"]["eventHistory"][number]): DuelEventPayload {
  return {
    ...(event.eventCode === undefined ? {} : { eventCode: event.eventCode }),
    ...(event.eventPlayer === undefined ? {} : { eventPlayer: event.eventPlayer }),
    ...(event.eventValue === undefined ? {} : { eventValue: event.eventValue }),
    ...(event.eventReason === undefined ? {} : { eventReason: event.eventReason }),
    ...(event.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: event.eventReasonPlayer }),
    ...(event.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: event.eventReasonCardUid }),
    ...(event.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: event.eventReasonEffectId }),
    ...(event.relatedEffectId === undefined ? {} : { relatedEffectId: event.relatedEffectId }),
    ...(event.eventChainDepth === undefined ? {} : { eventChainDepth: event.eventChainDepth }),
    ...(event.eventChainLinkId === undefined ? {} : { eventChainLinkId: event.eventChainLinkId }),
    ...(event.eventUids === undefined ? {} : { eventUids: event.eventUids }),
    ...(event.eventPreviousState === undefined ? {} : { eventPreviousState: event.eventPreviousState }),
    ...(event.eventCurrentState === undefined ? {} : { eventCurrentState: event.eventCurrentState }),
  };
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
    ...effect, ...((isKnownOverdoomLineAttackBoostEffect(snapshotEffect) || isKnownShootingcodeTalkerBattlePhaseDrawEffect(snapshotEffect) || snapshotEffect.luaConditionDescriptor?.startsWith("condition:attack-target-controller:self-no-player-flag:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:battle-phase-own-code-battler:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-battle-target") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-status-summon-type:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-relate-battle-target") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-own-faceup:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:normal-summon-proc-opponent-mzone-count-at-least:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:controller-has-faceup-setcode:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:event-player:") === true || snapshotEffect.luaConditionDescriptor === "condition:event-group-opponent-extra-deck-special-summon" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:event-previous-controller-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor === "condition:damage-source-relate-battle-target" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all-player:") === true || snapshotEffect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-side-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason-player:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-position:") === true) ? restoredLuaConditionCallbacks(snapshotEffect) : {}),
    ...(isKnownShootingcodeTalkerBattlePhaseDrawEffect(snapshotEffect) || isKnownByeByeDamagePreDamageEffect(snapshotEffect) || isKnownWattcubeIgnitionAttackBoostEffect(snapshotEffect) || isKnownPenetrationFusionStage2QuickEffect(snapshotEffect) || isKnownBattlinBoxerLeadYokeDestroyReplacementEffect(snapshotEffect) || isKnownParticleFusionCustomAttackEffect(snapshotEffect) ? { operation: restoredLuaOperation(snapshotEffect) } : {}),
    ...(snapshotEffect.property === undefined ? {} : { property: snapshotEffect.property }),
    ...(snapshotEffect.reset === undefined ? {} : { reset: { ...snapshotEffect.reset } }),
    ...(snapshotEffect.label === undefined ? {} : { label: snapshotEffect.label }),
    ...(snapshotEffect.labels === undefined ? {} : { labels: [...snapshotEffect.labels] }),
    ...(snapshotEffect.labelObjectId === undefined ? {} : { labelObjectId: snapshotEffect.labelObjectId }),
    ...(snapshotEffect.labelObjectUid === undefined ? {} : { labelObjectUid: snapshotEffect.labelObjectUid }),
    ...(snapshotEffect.labelObjectUids === undefined ? {} : { labelObjectUids: [...snapshotEffect.labelObjectUids] }),
    ...restoredLuaSemanticMetadata(snapshotEffect),
    ...restoredLuaTriggerMetadata(snapshotEffect),
    ...restoredLuaCostCallbacks(snapshotEffect),
    ...restoredLuaActivationTargetCallbacks(snapshotEffect),
    ...restoredLuaValueCallbacks(snapshotEffect),
    ...restoredLuaTargetCallbacks(snapshotEffect),
    ...(isKnownMirrorWallAttackHalveEffect(snapshotEffect) ? mirrorWallAttackHalveCallbacks(snapshotEffect) : {}),
    ...(isKnownOverdoomLineAttackBoostEffect(snapshotEffect) ? { targetCardPredicate: overdoomLineAttackBoostTarget(snapshotEffect) } : {}),
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
    (effect.event === "continuous" || effect.event === "trigger") &&
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

function isKnownArcanaForceHierophantLimiterEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaArcanaForceHierophantCode}:`)) &&
    effect.event === "continuous" &&
    effect.sourceUid !== undefined &&
    (effect.code === 1100 || effect.code === 1102 || effect.code === 1101 || effect.code === 1026) &&
    effect.range.length === duelLocations.length &&
    duelLocations.every((location) => effect.range.includes(location)) &&
    effect.reset?.flags === (luaResetPhase | luaPhaseEnd)
  );
}

function isKnownArcanaForceChariotRegisteredEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaArcanaForceChariotCode}:`)) &&
    effect.sourceUid !== undefined &&
    ((effect.event === "trigger" && effect.code === 1139 && effect.range.length === 1 && effect.range[0] === "monsterZone") ||
      (effect.event === "continuous" && effect.code === luaEventAdjust && effect.range.length === 1 && effect.range[0] === "monsterZone")) &&
    effect.reset?.flags === luaResetEventStandard
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
  const celestialTypeBranchSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownCelestialMagicianEndSearchEffect(effect))
      .map((effect) => effect.sourceUid),
  );
  const dragodiesEndSearchSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownDragodiesEndSearchEffect(effect))
      .map((effect) => effect.sourceUid),
  );
  const hierophantLimiterSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownArcanaForceHierophantLimiterEffect(effect))
      .map((effect) => effect.sourceUid),
  );
  const chariotRegisteredSourceUids = new Set(
    snapshotEffects
      .filter((effect) => effect.registryKey && registryKeys.has(effect.registryKey) && isKnownArcanaForceChariotRegisteredEffect(effect))
      .map((effect) => effect.sourceUid),
  );
  const restoreBlazeCannonRaEffects = snapshotEffects.some((effect) => effect.registryKey?.startsWith(`lua:${luaBlazeCannonCode}:lua-3-1130`) && registryKeys.has(effect.registryKey));
  const results: LuaScriptLoadResult[] = [];
  if (restoreBlazeCannonRaEffects) {
    const ra = session.state.cards.find((card) => card.code === "10000010" && card.location === "monsterZone");
    if (ra) {
      const script = `
        local s=c${luaBlazeCannonCode}
        local tc=Duel.GetFieldCard(${ra.controller},LOCATION_MZONE,${ra.sequence})
        if s and tc and tc:IsFieldID(${cardFieldId(ra)}) then
          local e1=Effect.CreateEffect(tc)
          e1:SetDescription(3110)
          e1:SetType(EFFECT_TYPE_SINGLE)
          e1:SetCode(EFFECT_IMMUNE_EFFECT)
          e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CLIENT_HINT)
          e1:SetRange(LOCATION_MZONE)
          e1:SetValue(s.efilter)
          e1:SetReset(RESETS_STANDARD_PHASE_END)
          tc:RegisterEffect(e1)
          local e2=Effect.CreateEffect(tc)
          e2:SetCategory(CATEGORY_ATKCHANGE)
          e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
          e2:SetCode(EVENT_ATTACK_ANNOUNCE)
          e2:SetRange(LOCATION_MZONE)
          e2:SetCondition(s.atkcon)
          e2:SetCost(s.atkcost)
          e2:SetOperation(s.atkop)
          e2:SetReset(RESETS_STANDARD_PHASE_END)
          tc:RegisterEffect(e2)
          local e3=Effect.CreateEffect(tc)
          e3:SetCategory(CATEGORY_TOGRAVE)
          e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
          e3:SetCode(EVENT_BATTLED)
          e3:SetCondition(s.sendcon)
          e3:SetTarget(s.sendtg)
          e3:SetOperation(s.sendop)
          e3:SetReset(RESETS_STANDARD_PHASE_END)
          tc:RegisterEffect(e3)
        end
      `;
      results.push(host.loadScript(script, `c${luaBlazeCannonCode}.lua`));
    }
  }
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
  for (const sourceUid of celestialTypeBranchSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "monsterZone") continue;
    const script = `
      local c=Duel.GetFieldCard(${card.controller},LOCATION_MZONE,${card.sequence})
      if c and c:IsFieldID(${cardFieldId(card)}) then
        local e1=Effect.CreateEffect(c)
        e1:SetDescription(3205)
        e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_DIRECT_ATTACK)
        e1:SetValue(1)
        e1:SetReset(RESETS_STANDARD_PHASE_END)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_FIELD)
        e2:SetCode(EFFECT_CANNOT_ACTIVATE)
        e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e2:SetTargetRange(0,1)
        e2:SetValue(function(e,re,tp) return re:IsMonsterEffect() end)
        e2:SetReset(RESETS_STANDARD_PHASE_END)
        Duel.RegisterEffect(e2,${card.controller})
        local e3=Effect.CreateEffect(c)
        e3:SetType(EFFECT_TYPE_SINGLE)
        e3:SetCode(EFFECT_SET_ATTACK_FINAL)
        e3:SetValue(c:GetBaseAttack()*2)
        e3:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)
        c:RegisterEffect(e3)
        local e4=Effect.CreateEffect(c)
        e4:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e4:SetCode(EVENT_PHASE+PHASE_END)
        e4:SetCountLimit(1)
        e4:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
          local g=Duel.SelectMatchingCard(tp,function(tc) return tc:IsType(TYPE_PENDULUM) and tc:IsAbleToHand() end,tp,LOCATION_DECK,0,1,1,nil)
          if #g>0 then
            Duel.SendtoHand(g,nil,REASON_EFFECT)
            Duel.ConfirmCards(1-tp,g)
          end
        end)
        e4:SetReset(RESET_PHASE|PHASE_END)
        Duel.RegisterEffect(e4,${card.controller})
      end
    `;
    results.push(host.loadScript(script, `restore-celestial-magician-type-branch-${card.uid}.lua`));
  }
  for (const sourceUid of dragodiesEndSearchSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card || card.location !== "extraDeck") continue;
    const script = `
      local c=Duel.GetFirstMatchingCard(function(tc) return tc:IsFieldID(${cardFieldId(card)}) end,${card.controller},LOCATION_EXTRA,0,nil)
      if c then
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e1:SetCode(EVENT_PHASE+PHASE_END)
        e1:SetCountLimit(1)
        e1:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.IsExistingMatchingCard(function(tc) return tc:IsAttackBelow(2000) and tc:IsRace(RACE_WARRIOR|RACE_SPELLCASTER) and not tc:IsCode(${luaDragodiesCode}) and tc:IsAbleToHand() end,tp,LOCATION_DECK,0,1,nil)
        end)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.Hint(HINT_CARD,0,${luaDragodiesCode})
          Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
          local g=Duel.SelectMatchingCard(tp,function(tc) return tc:IsAttackBelow(2000) and tc:IsRace(RACE_WARRIOR|RACE_SPELLCASTER) and not tc:IsCode(${luaDragodiesCode}) and tc:IsAbleToHand() end,tp,LOCATION_DECK,0,1,1,nil)
          if #g>0 then
            Duel.SendtoHand(g,nil,REASON_EFFECT)
            Duel.ConfirmCards(1-tp,g)
          end
        end)
        e1:SetReset(RESET_PHASE|PHASE_END)
        Duel.RegisterEffect(e1,${card.controller})
      end
    `;
    results.push(host.loadScript(script, `restore-dragodies-end-search-${card.uid}.lua`));
  }
  for (const sourceUid of hierophantLimiterSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card) continue;
    const script = `
      local s=c${luaArcanaForceHierophantCode}
      local c=Duel.GetFirstMatchingCard(function(tc) return tc:IsFieldID(${cardFieldId(card)}) end,${card.controller},${cardLocationMask(card.location)},0,nil)
      if s and c then
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e1:SetCode(EVENT_SUMMON_SUCCESS)
        e1:SetOperation(s.limop1)
        e1:SetReset(RESET_PHASE|PHASE_END)
        Duel.RegisterEffect(e1,${card.controller})
        local e2=e1:Clone()
        e2:SetCode(EVENT_SPSUMMON_SUCCESS)
        Duel.RegisterEffect(e2,${card.controller})
        local e3=e1:Clone()
        e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
        Duel.RegisterEffect(e3,${card.controller})
        local e4=e1:Clone()
        e4:SetCode(EVENT_CHAIN_END)
        e4:SetOperation(s.limop2)
        Duel.RegisterEffect(e4,${card.controller})
      end
    `;
    results.push(host.loadScript(script, `restore-arcana-force-hierophant-limiter-${card.uid}.lua`));
  }
  for (const sourceUid of chariotRegisteredSourceUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === sourceUid);
    if (!card) continue;
    const script = `
      local s=c${luaArcanaForceChariotCode}
      local c=Duel.GetFirstMatchingCard(function(tc) return tc:IsFieldID(${cardFieldId(card)}) end,${card.controller},${cardLocationMask(card.location)},0,nil)
      if s and c then
        s.arcanareg(c,c:GetFlagEffectLabel(${luaArcanaForceChariotCode}) or COIN_HEADS)
      end
    `;
    results.push(host.loadScript(script, `restore-arcana-force-chariot-registered-${card.uid}.lua`));
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
    const knownRestorable = isKnownRestorableLuaEffect(effect, snapshotEffects) || isKnownMagnificentMachineAngelBattleStartDisableEffect(effect);
    if (!registryKeys.has(effect.registryKey) && !(knownRestorable && (isKnownSelfEndPhaseDestroyEffect(effect) || isKnownSelfEndPhaseBanishEffect(effect) || isKnownLimiterRemovalDelayedDestroyEffect(effect) || isKnownRagingMadPlantsDelayedDestroyEffect(effect) || isKnownEngraverOfTheMarkDelayedDestroyEffect(effect) || isKnownTemporaryBanishReturnToFieldEffect(effect) || isKnownEvolsaurCeratoBattleDestroyingSearchEffect(effect) || isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect) || isKnownByeByeDamageBattleDamageReflectEffect(effect) || isKnownByeByeDamageSyntheticBattleIndestructibleEffect(effect) || isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect) || isKnownOverdoomLineEndPhaseDestroyEffect(effect) || isKnownMagnificentMachineAngelBattleStartDisableEffect(effect) || isKnownGauntletWarriorDamageStepResetEffect(effect) || isKnownCyberOgreDamageStepResetEffect(effect) || isKnownCastleDarkIllusionsStandbyStatEffect(effect)))) continue;
    refreshKnownRestoredLuaEffect(session, effect);
    if (restored.has(effect.registryKey)) continue;
    if (!knownRestorable) continue;
    const semanticMetadata = restoredLuaSemanticMetadata(effect);
    const restoredEffect: SerializedDuelEffect = { ...effect, ...semanticMetadata };
    const reset = restoredLuaEffectReset(session, restoredEffect);
    session.state.effects.push({
      ...restoredEffect,
      range: restoredLuaEffectRange(restoredEffect),
      ...(reset ? { reset } : {}),
      ...(restoredEffect.targetRange ? { targetRange: [...restoredEffect.targetRange] } : {}),
      ...(restoredEffect.hintTiming ? { hintTiming: [...restoredEffect.hintTiming] } : {}),
      ...restoredLuaTriggerMetadata(restoredEffect),
      ...restoredLuaTypeFlagMetadata(session, restoredEffect),
      ...restoredLuaValueCallbacks(restoredEffect),
      ...restoredLuaConditionCallbacks(restoredEffect), ...restoredLuaCostCallbacks(restoredEffect),
      ...restoredLuaTargetCallbacks(restoredEffect),
      ...(isKnownMirrorWallAttackHalveEffect(restoredEffect) ? mirrorWallAttackHalveCallbacks(restoredEffect) : {}),
      ...(isKnownOverdoomLineAttackBoostEffect(restoredEffect) ? { targetCardPredicate: overdoomLineAttackBoostTarget(restoredEffect) } : {}),
      ...restoredLuaActivationTargetCallbacks(restoredEffect),
      operation: restoredLuaOperation(restoredEffect, snapshotEffects),
    });
    added.push(effect.registryKey);
  }
  return added;
}

function restoreMagnificentMachineAngelBattleStartDisableEffects(
  session: DuelSession,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: string[],
): string[] {
  const restored = new Set(restoredRegistryKeys);
  const added: string[] = [];
  for (const effect of snapshotEffects) {
    if (!effect.registryKey || restored.has(effect.registryKey) || !isKnownMagnificentMachineAngelBattleStartDisableEffect(effect)) continue;
    session.state.effects.push({
      ...effect,
      range: restoredLuaEffectRange(effect),
      ...(effect.reset ? { reset: { ...effect.reset } } : {}),
      operation: magnificentMachineAngelBattleStartDisableOperation(effect),
    });
    restored.add(effect.registryKey);
    added.push(effect.registryKey);
  }
  return added;
}

function restoreDoubleOrNothingBattleStartEffects(
  session: DuelSession,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: string[],
): string[] {
  const restored = new Set(restoredRegistryKeys);
  const added: string[] = [];
  for (const effect of snapshotEffects) {
    if (!effect.registryKey || restored.has(effect.registryKey) || !isKnownDoubleOrNothingBattleStartDoubleEffect(effect)) continue;
    session.state.effects.push({
      ...effect,
      event: "trigger",
      range: restoredLuaEffectRange(effect),
      ...(effect.reset ? { reset: { ...effect.reset } } : {}),
      ...restoredLuaTriggerMetadata(effect),
      operation: doubleOrNothingBattleStartDoubleOperation(effect),
    });
    restored.add(effect.registryKey);
    added.push(effect.registryKey);
  }
  return added;
}

function restoredLuaSemanticMetadata(effect: SerializedDuelEffect): Partial<Pick<SerializedDuelEffect, "event" | "luaTargetDescriptor" | "luaValueDescriptor">> {
  if (isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect)) return { event: "trigger" };
  if (isKnownDoubleOrNothingBattleStartDoubleEffect(effect)) return { event: "trigger" };
  if (isKnownMagnificentMachineAngelBattleStartDisableEffect(effect)) return { event: "trigger" };
  if (isKnownEucalyptusMoleNonEffectBeastAttackBoost(effect)) {
    return {
      luaTargetDescriptor: "target:non-effect-race:16384",
      luaValueDescriptor: "stat:base-defense",
    };
  }
  if (isKnownWattcubeIgnitionAttackBoostEffect(effect)) return { luaTargetDescriptor: "target:faceup-race:8192" };
  return {};
}

function restoredLuaEffectRange(effect: SerializedDuelEffect): DuelCardInstance["location"][] {
  if (isKnownByeByeDamageBattleDamageReflectEffect(effect)) return [...new Set([...effect.range, "graveyard" as const])];
  return [...effect.range];
}

function restoredLuaTypeFlagMetadata(session: DuelSession, effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "luaTypeFlags"> {
  const source = session.state.cards.find((card) => card.uid === effect.sourceUid);
  if (effect.event === "continuous" && isKnownStatValueEffect(effect) && effect.range.length === 1 && effect.range[0] === "spellTrapZone" && source?.equippedToUid !== undefined) {
    return { luaTypeFlags: 0x4 };
  }
  return {};
}

function restoredLuaTriggerMetadata(effect: SerializedDuelEffect): Partial<Pick<DuelEffectDefinition, "triggerEvent" | "triggerCode" | "triggerTiming">> {
  if (isKnownBorreloadExchargeEndPhaseBanishEffect(effect)) return { triggerEvent: "phaseEnd" as const, triggerCode: luaPhaseEndEventCode, triggerTiming: "if" as const };
  if (isKnownMetaphysRagnarokEndPhaseBanishEffect(effect)) return { triggerEvent: "phaseEnd" as const, triggerCode: luaPhaseEndEventCode, triggerTiming: "if" as const };
  if (isKnownCelestialMagicianEndSearchEffect(effect)) return { triggerEvent: "phaseEnd" as const, triggerCode: luaPhaseEndEventCode, triggerTiming: "if" as const };
  if (isKnownSpellbookPowerBattleDestroyingSearchEffect(effect)) return { triggerEvent: "battleDestroyed" as const, triggerCode: 1139, triggerTiming: "if" as const };
  if (isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect)) return { triggerEvent: "battleDamageDealt" as const, triggerCode: luaEventBattleDamage, triggerTiming: "when" as const };
  if (isKnownSelfEndPhaseDestroyEffect(effect) || isKnownSelfEndPhaseSendEffect(effect) || isKnownSelfEndPhaseReturnToHandEffect(effect) || isKnownSelfEndPhaseBanishEffect(effect) || isKnownDelayedGroupSendToHandEffect(effect) || isKnownWakeCupMochaDelayedSendToGraveEffect(effect) || isKnownLimiterRemovalDelayedDestroyEffect(effect) || isKnownRagingMadPlantsDelayedDestroyEffect(effect) || isKnownEngraverOfTheMarkDelayedDestroyEffect(effect) || isKnownPurushaddollAeonDelayedFlipEffect(effect) || isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect) || isKnownTemporaryBanishReturnToFieldEffect(effect) || isKnownDelayedBattleDestroyPhaseEffect(effect)) return { triggerEvent: "phaseEnd" as const, triggerCode: luaPhaseEndEventCode, triggerTiming: "if" as const };
  if (isKnownOuroborosSageAttackLimitWatcherEffect(effect) || isKnownOuroborosSageAttackDoubleEffect(effect)) return { triggerEvent: "attackDeclared" as const, triggerCode: 1130, triggerTiming: "when" as const };
  if (isKnownDoubleOrNothingBattleStartDoubleEffect(effect)) return { triggerEvent: "battleStarted" as const, triggerCode: 1132, triggerTiming: "when" as const };
  if (isKnownMagnificentMachineAngelBattleStartDisableEffect(effect)) return { triggerEvent: "battleStarted" as const, triggerCode: 1132, triggerTiming: "when" as const };
  if (isKnownCarpedivemTurnEndHintResetEffect(effect)) return { triggerEvent: "turnEnded" as const, triggerCode: 1210, triggerTiming: "if" as const };
  if (isKnownMaharaghiPredrawEffect(effect) || isKnownHinoKaguTsuchiPredrawDiscardEffect(effect)) return { triggerEvent: "preDraw" as const, triggerCode: 1113, triggerTiming: "if" as const };
  if (isKnownYellowAlertDelayedReturnEffect(effect)) return { triggerEvent: "phaseBattle" as const, triggerCode: 0x1080, triggerTiming: "if" as const };
  if (isKnownPrimePhotonDragonStandbyReviveEffect(effect)) return { triggerEvent: "phaseStandby" as const, triggerCode: luaPhaseStandbyEventCode, triggerTiming: "if" as const };
  return {}; }

function refreshKnownRestoredLuaEffect(session: DuelSession, effect: SerializedDuelEffect): void {
  if (!effect.registryKey || (!isKnownSelfEndPhaseDestroyEffect(effect) && !isKnownSelfEndPhaseSendEffect(effect) && !isKnownSelfEndPhaseReturnToHandEffect(effect) && !isKnownSelfEndPhaseBanishEffect(effect) && !isKnownDelayedBattleDestroyPhaseEffect(effect) && !isKnownWakeCupMochaDelayedSendToGraveEffect(effect) && !isKnownLimiterRemovalDelayedDestroyEffect(effect) && !isKnownRagingMadPlantsDelayedDestroyEffect(effect) && !isKnownEngraverOfTheMarkDelayedDestroyEffect(effect) && !isKnownMetaphysRagnarokEndPhaseBanishEffect(effect) && !isKnownTemporaryBanishReturnToFieldEffect(effect))) return;
  const restored = session.state.effects.find((candidate) => candidate.registryKey === effect.registryKey);
  if (!restored) return;
  Object.assign(restored, {
    ...restoredLuaTriggerMetadata(effect),
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
    isKnownGagagaGirlXyzAttackZeroTriggerEffect(effect) ||
    isKnownXyzMaterialAttackGainTriggerEffect(effect) ||
    isKnownSunlitSentinelDelayedStandbyEffect(effect) ||
        isKnownSelfEndPhaseDestroyEffect(effect) ||
        isKnownSelfEndPhaseBanishEffect(effect) ||
        isKnownLimiterRemovalDelayedDestroyEffect(effect) ||
        isKnownRagingMadPlantsDelayedDestroyEffect(effect) ||
        isKnownSelfEndPhaseSendEffect(effect) ||
    isKnownSelfEndPhaseReturnToHandEffect(effect) ||
    isKnownEbonArrowBattleDestroyingDamageEffect(effect) ||
    isKnownMiniGutsBattleDestroyedDamageEffect(effect) ||
    isKnownSpellbookPowerBattleDestroyingSearchEffect(effect) ||
    isKnownEvolsaurCeratoBattleDestroyingSearchEffect(effect) ||
    isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect) ||
    isKnownShiranuiSamuraiBattledBanishEffect(effect) ||
    isKnownAlchemyCycleBattleDestroyedDrawEffect(effect) ||
    isKnownUradoraBattleDestroyingDrawRecoverEffect(effect) ||
    isKnownPhotonTridentBattleDamageDestroyEffect(effect) ||
    isKnownByeByeDamageBattleDamageReflectEffect(effect) ||
    isKnownByeByeDamageSyntheticBattleIndestructibleEffect(effect) ||
    isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect) ||
    isKnownOverdoomLineEndPhaseDestroyEffect(effect) ||
    isKnownDoubleOrNothingBattleStartDoubleEffect(effect) ||
    isKnownMagnificentMachineAngelBattleStartDisableEffect(effect) ||
    isKnownMermailAbyssbalaenBattleStartDestroyEffect(effect) ||
    isKnownDivineEvolutionAttackAnnounceSendEffect(effect) ||
    isKnownOuroborosSageAttackLimitWatcherEffect(effect) ||
    isKnownOuroborosSageAttackDoubleEffect(effect) ||
    isKnownMachineKing3000BcAttackBoostEffect(effect) ||
    isKnownClashingSoulsBattledFieldSendEffect(effect) ||
    isKnownShootingcodeTalkerBattlePhaseDrawEffect(effect) ||
    isKnownHunterSevenWeaponsPreDamageEffect(effect) ||
    isKnownPrimePhotonDragonStandbyReviveEffect(effect) ||
    isKnownDinowrestlerMartialAnkyloEndPhaseSummonEffect(effect) ||
    isKnownTaiStrikeDamageStepEndEffect(effect) || isKnownAssaultSpiritsDamageStepEquipEffect(effect) ||
    isKnownGauntletWarriorDamageStepResetEffect(effect) || isKnownCyberOgreDamageStepResetEffect(effect) ||
    isKnownCastleDarkIllusionsStandbyStatEffect(effect) ||
    isKnownWattcubeIgnitionAttackBoostEffect(effect) ||
    isKnownPenetrationFusionStage2QuickEffect(effect) ||
    isKnownParticleFusionCustomAttackEffect(effect) ||
    isKnownArcanaForceMoonPhaseRestorableEffect(effect) ||
    (effect.event === "continuous" &&
      (effect.code === 2 ||
        effect.code === 8 ||
        effect.code === 22 ||
        isKnownGeminiStatusEffect(effect) ||
        isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects) ||
        isKnownSpiritAddTypeEffect(effect) ||
        isKnownTemporaryTunerAddTypeEffect(effect) ||
        isKnownTemporaryCannotTriggerEffect(effect) ||
        isKnownXyzMaterialEffectAddType(effect) ||
        isKnownChangeCodeEffect(effect) ||
        isKnownChangeTypeEffect(effect) ||
        isKnownSwapBaseAdEffect(effect) ||
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
        isKnownBattleguardRageTargetLeaveSelfDestroyEffect(effect) ||
        effect.code === 25 ||
        (effect.code === 60 && effect.value !== undefined) ||
        (effect.code === 92 && (specialSummonTypeNotCostDescriptor(effect.luaCostDescriptor) !== undefined || specialSummonTypeIsCostDescriptor(effect.luaCostDescriptor) !== undefined)) ||
        (effect.code === 30 && effect.luaValueDescriptor?.startsWith("special-summon-condition:") === true) ||
        effect.code === luaEffectClockLizard ||
        isKnownCannotBeMaterialEffect(effect) ||
        (effect.code === 71 && effect.luaValueDescriptor === "cannot-be-effect-target:opponent") ||
        (effect.code === 1 && (effect.luaValueDescriptor === "immune-effect:opponent-card-effects" || effect.luaValueDescriptor === "immune-effect:monster-effects")) ||
        (effect.code === 73 && effect.sourceUid !== undefined && effect.reset !== undefined) ||
        isKnownIndestructibleValueEffect(effect) ||
        effect.luaValueDescriptor === "change-damage:effect-double" || (effect.luaValueDescriptor === "change-damage:effect-zero" && effect.reset !== undefined) ||
        effect.luaValueDescriptor === "reflect-damage:opponent-non-continuous" ||
        isKnownLifePointReasonPredicateEffect(effect) ||
        isKnownIndestructibleCountReasonPredicateEffect(effect) ||
        isKnownReinforceMonsterEffectImmunity(effect) ||
        isKnownSagaDragonEmperorCannotInactivateEffect(effect) ||
        isKnownDivineEvolutionCannotNegateEffect(effect) ||
        isKnownCannotSelectBattleTargetNotHandlerEffect(effect) ||
        isKnownChangeBattleStatToDefenseEffect(effect) ||
        isKnownTargetScopedHalfBattleDamageEffect(effect) ||
        isKnownLifeHackOpponentHalfBattleDamageEffect(effect) ||
        isKnownDharcProcedurePierceEffect(effect) ||
        isKnownTemporaryPierceEffect(effect) ||
        isKnownYellowAlertDelayedReturnEffect(effect) ||
        isKnownDelayedSendToHandEffect(effect) ||
        isKnownDelayedGroupSendToHandEffect(effect) ||
        isKnownWakeCupMochaDelayedSendToGraveEffect(effect) ||
        isKnownCalledByTheGraveChainSolvingNegateEffect(effect) ||
        isKnownSameOriginalCodeChainSolvingNegateEffect(effect) ||
        isKnownGishkiEmiliaTrapNegateEffect(effect) ||
        isKnownRareMetalmorphChainSolvingNegateEffect(effect) ||
        isKnownWorldLegacyWhispersSpellNegateEffect(effect) ||
        isKnownCarpedivemTurnEndHintResetEffect(effect) ||
        isKnownTrapMonsterDisableEffect(effect) ||
        isKnownBookOfEclipsePhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightPhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightResetEffect(effect) ||
        isKnownTemporaryPlayerAttackAnnounceLockEffect(effect) || isKnownTemporaryFieldIdAttackAnnounceLockEffect(effect) || isKnownTemporarySetcodeAttackAnnounceLockEffect(effect) || isKnownTemporaryAttackAnnounceNegateEffect(effect) || isKnownTemporaryAttackAnnounceLabelObjectWatcherEffect(effect) || isKnownTemporaryBattledSetAttackFinalWatcherEffect(effect) || isKnownTemporaryCannotAttackEffect(effect) || isKnownTemporaryCannotAttackAnnounceSelfEffect(effect) || isKnownTemporaryDirectAttackEffect(effect) || isKnownTemporaryCannotDirectAttackEffect(effect) || isKnownTemporaryBattleProtectionEffect(effect) || isKnownTemporaryPlayerHalfBattleDamageEffect(effect) || isKnownPlayerDamageZeroEffect(effect) || isKnownTemporaryMonsterNoBattleDamageEffect(effect) || isKnownTemporaryMonsterBattleDamageAvoidEffect(effect) || isKnownTemporaryMonsterExtraAttackEffect(effect) || isKnownTemporaryMonsterAttackAllEffect(effect) || isKnownTemporaryTypeTargetAttackUpdateEffect(effect) || isKnownTemporaryMustAttackEffect(effect) || isKnownTemporarySummonSetLockEffect(effect) || isKnownTemporaryActivationLockEffect(effect) || isKnownTemporaryForbiddenCardEffect(effect) || isKnownStaticForbiddenCardEffect(effect) || isKnownTemporarySelfTurnSkipBattlePhaseEffect(effect) || isKnownTemporaryOpponentTurnSkipMain1Effect(effect) || isKnownTemporaryOpponentTurnSkipMain2Effect(effect) || isKnownTemporarySelfTurnCannotEndPhaseEffect(effect) || isKnownTemporarySameCodeActivationOathEffect(effect) || isKnownTemporaryOpponentTurnSkipTurnEffect(effect) || isKnownTemporaryOpponentCannotBattlePhaseEffect(effect) || isKnownTemporaryArtifactLanceaBanishLockEffect(effect) || isKnownTemporaryEarthshatteringDeckGraveLockEffect(effect) ||
        isAssaultZoneExtraDeckReleaseRestoreEffect(effect) ||
        isKnownMaharaghiPredrawEffect(effect) ||
        isKnownHinoKaguTsuchiPredrawDiscardEffect(effect) ||
        isKnownGreatLongNoseSkipBattlePhaseEffect(effect) ||
        isKnownUnleashYourPowerDelayedSetEffect(effect) ||
        isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect) ||
        isKnownEngraverOfTheMarkDelayedDestroyEffect(effect) ||
        isKnownPurushaddollAeonDelayedFlipEffect(effect) ||
        isKnownTemporaryBanishReturnToFieldEffect(effect) ||
        isKnownMulcharmyDrawWatcherEffect(effect) ||
        isKnownMulcharmyEndPhaseShuffleEffect(effect) ||
        isKnownZeroParadoxDelayedScaleDestroyEffect(effect) ||
        isKnownLevelNormalEndPhaseDestroyEffect(effect) ||
        isKnownDelayedBattleDestroyMarkerEffect(effect) ||
        isKnownDelayedBattleDestroyPhaseEffect(effect) ||
        isKnownBorreloadExchargeEndPhaseBanishEffect(effect) ||
        isKnownMetaphysRagnarokEndPhaseBanishEffect(effect) ||
        isKnownCelestialMagicianTypeBranchEffect(effect) ||
        isKnownVictoryViperOptionTokenEffect(effect) ||
        isKnownCelestialMagicianEndSearchEffect(effect) ||
        isKnownEndPhaseReviveDestroyEffect(effect) ||
        isKnownDinowrestlerMartialAnkyloEndPhaseSummonEffect(effect) ||
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
        isKnownCommonSoulOwnerTargetAttackEffect(effect) ||
        isKnownPenetrationFusionStage2QuickEffect(effect) ||
        isKnownParticleFusionCustomAttackEffect(effect) ||
        isKnownBattlinBoxerLeadYokeDestroyReplacementEffect(effect) ||
        isKnownEucalyptusMoleNonEffectBeastAttackBoost(effect) ||
        isKnownStatValueEffect(effect)))
  );
}

function isKnownChangeBattleStatToDefenseEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 198 && effect.luaValueDescriptor === "stat:current-defense" && effect.luaTargetDescriptor === "target:source-or-battle-target" && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "monsterZone" && effect.targetRange?.[0] === 4 && effect.targetRange?.[1] === 4 && effect.reset !== undefined; }
function isKnownPenetrationFusionStage2QuickEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaPenetrationFusionCode}:`)) &&
    effect.event === "quick" &&
    effect.code === 1002 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.luaCostDescriptor === "cost:self-tribute" &&
    effect.category === luaCategoryAtkChange &&
    effect.property === (0x10 | 0x4000) &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}

function isKnownWattcubeIgnitionAttackBoostEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaWattcubeCode}:`)) &&
    effect.event === "ignition" &&
    effect.code === undefined &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone";
}
function isKnownBattlinBoxerLeadYokeDestroyReplacementEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaBattlinBoxerLeadYokeCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 50 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}
function isKnownParticleFusionCustomAttackEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaParticleFusionCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 0x10000000 + Number(luaParticleFusionCode) &&
    effect.triggerEvent === "customEvent" &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.category === luaCategoryAtkChange &&
    effect.property === 0x10;
}
function isKnownArcanaForceMoonPhaseRestorableEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaArcanaForceMoonCode}:`)) &&
    effect.event === "trigger" &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    (
      (effect.code === luaPhaseStandbyEventCode && effect.triggerEvent === "phaseStandby" && ((effect.category ?? 0) & luaCategorySpecialSummon) !== 0) ||
      (effect.code === luaPhaseEndEventCode && effect.triggerEvent === "phaseEnd" && ((effect.category ?? 0) & luaCategoryControl) !== 0)
    );
}
function isKnownArcanaForceMoonPhaseEffect(effect: SerializedDuelEffect): boolean {
  return isKnownArcanaForceMoonStandbyTokenEffect(effect) || isKnownArcanaForceMoonEndControlEffect(effect);
}
function isKnownArcanaForceMoonStandbyTokenEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaArcanaForceMoonCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === luaPhaseStandbyEventCode &&
    effect.triggerEvent === "phaseStandby" &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.category === (luaCategorySpecialSummon | luaCategoryToken);
}
function isKnownArcanaForceMoonEndControlEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaArcanaForceMoonCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === luaPhaseEndEventCode &&
    effect.triggerEvent === "phaseEnd" &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.category === luaCategoryControl;
}
function isKnownHunterSevenWeaponsPreDamageEffect(effect: SerializedDuelEffect): boolean { return Boolean(effect.registryKey?.startsWith("lua:1525329:")) && effect.event === "trigger" && effect.code === 1134 && effect.triggerEvent === "beforeDamageCalculation" && effect.label !== undefined && effect.sourceUid !== undefined; }
function isKnownPrimePhotonDragonStandbyReviveEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:31801517:")) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseStandbyEventCode &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "graveyard" &&
    effect.reset?.flags === 0x51fe1002 &&
    effect.reset.count === 2 &&
    effect.targetRange === undefined;
}
function isKnownVictoryViperOptionTokenEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:93130021:")) &&
    effect.event === "continuous" &&
    [102, 106, 122, 127, 131, 141].includes(effect.code ?? 0) &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.reset?.flags === 0xfe1000;
}
function isKnownTargetScopedHalfBattleDamageEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" &&
    effect.code === 208 &&
    effect.value === undefined &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.reset !== undefined &&
    effect.targetRange === undefined;
}

function isKnownLifeHackOpponentHalfBattleDamageEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:83589191:")) &&
    effect.event === "continuous" &&
    effect.code === 82 &&
    effect.value === undefined &&
    effect.sourceUid !== undefined &&
    effect.targetRange?.[0] === 0 &&
    effect.targetRange?.[1] === 1 &&
    effect.reset !== undefined;
}
function isKnownZeroParadoxDelayedScaleDestroyEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:97417863:")) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.triggerEvent === "phaseEnd" &&
    effect.sourceUid !== undefined &&
    (effect.labelObjectUid !== undefined || (effect.labelObjectUids?.length ?? 0) > 0) &&
    effect.reset?.flags !== undefined &&
    effect.reset.count === 2;
}
function zeroParadoxDelayedScaleDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const targetUid = effect.labelObjectUid;
    const target = targetUid ? ctx.duel.cards.find((card) => card.uid === targetUid) : undefined;
    if (!target) return;
    try {
      destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style delayed operations ignore targets that can no longer be destroyed.
    }
  };
}
function effectReasonIdPayload(effect: SerializedDuelEffect): { eventReasonEffectId: number } | Record<string, never> {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? { eventReasonEffectId: id } : {};
}
function nextLuaEffectId(effect: SerializedDuelEffect, code: number): string {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? `lua-${id + 1}-${code}` : `${effect.id}-restored-${code}`;
}
function isKnownChangeCodeEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 114 && effect.value !== undefined && effect.sourceUid !== undefined && effect.targetRange === undefined; }
function isKnownChangeTypeEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 117 && effect.value !== undefined && effect.sourceUid !== undefined && effect.targetRange === undefined; }
function isKnownSwapBaseAdEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 110 && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "monsterZone" && effect.targetRange === undefined && effect.reset !== undefined; }
function isKnownDharcProcedurePierceEffect(effect: SerializedDuelEffect): boolean { return Boolean(effect.registryKey?.startsWith(`lua:${luaFamiliarPossessedDharcCode}:`)) && effect.event === "continuous" && effect.code === luaEffectPierce && effect.sourceUid !== undefined && hasDefaultLuaFieldRange(effect) && effect.reset?.flags === 0xff1000; }
function isKnownTemporaryPierceEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === luaEffectPierce && effect.sourceUid !== undefined && effect.reset !== undefined; }
function isKnownEbonArrowBattleDestroyingDamageEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaEbonArrowCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1139 &&
    effect.triggerEvent === "battleDestroyed" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownMiniGutsBattleDestroyedDamageEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaMiniGutsCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1140 &&
    effect.triggerEvent === "battleDestroyed" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownSpellbookPowerBattleDestroyingSearchEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaSpellbookOfPowerCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1139 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "battleDestroyed") &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.reset !== undefined &&
    ((effect.category ?? 0) & 0x8) !== 0 &&
    hasDefaultLuaFieldRange(effect);
}
function isKnownEvolsaurCeratoBattleDestroyingSearchEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaEvolsaurCeratoCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1139 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "battleDestroyed") &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    ((effect.category ?? 0) & 0x8) !== 0 &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}
function isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaUtopiaEnvoyCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1139 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "battleDestroyed") &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}
function isKnownShiranuiSamuraiBattledBanishEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaShiranuiSamuraiCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1138 &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}
function isKnownUradoraBattleDestroyingDrawRecoverEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaUradoraOfFateCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1139 &&
    effect.triggerEvent === "battleDestroyed" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownPhotonTridentBattleDamageDestroyEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaPhotonTridentCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === luaEventBattleDamage &&
    effect.triggerEvent === "battleDamageDealt" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownByeByeDamageBattleDamageReflectEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaByeByeDamageCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaEventBattleDamage &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}
function isKnownByeByeDamageSyntheticBattleIndestructibleEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaByeByeDamageCode}:`) && effect.registryKey.endsWith(":battle-indestructible")) &&
    effect.event === "continuous" &&
    effect.code === luaEffectIndestructibleBattle &&
    effect.sourceUid !== undefined &&
    effect.value === 1 &&
    effect.reset !== undefined;
}
function isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaByeByeDamageCode}:`) && effect.registryKey.endsWith(":battle-damage-reflect")) &&
    (effect.event === "continuous" || effect.event === "trigger") &&
    effect.code === luaEventBattleDamage &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownMirrorWallAttackHalveEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaMirrorWallCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 102 &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone" &&
    (effect.labelObjectUids?.length ?? 0) > 0;
}
function isKnownOverdoomLineEndPhaseDestroyEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaOverdoomLineCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === 0x51fe1200 &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone";
}
function isKnownOverdoomLineAttackBoostEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaOverdoomLineCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 100 &&
    effect.sourceUid !== undefined &&
    effect.value === 1000 &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone" &&
    effect.targetRange?.[0] === luaLocationMonsterZone &&
    effect.targetRange?.[1] === luaLocationMonsterZone;
}
function isKnownMermailAbyssbalaenBattleStartDestroyEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaMermailAbyssbalaenCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === 1132 &&
    effect.triggerEvent === "battleStarted" &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownDoubleOrNothingBattleStartDoubleEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaDoubleOrNothingCode}:`)) &&
    (effect.event === "continuous" || effect.event === "trigger") &&
    effect.code === 1132 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "battleStarted") &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function doubleOrNothingBattleStartDoubleOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    if (!source || battle?.attackerUid !== source.uid) return;
    const attack = currentAttack(source, ctx.duel);
    ctx.duel.effects.push({
      id: `${effect.id}-set-attack-final`,
      sourceUid: source.uid,
      controller: effect.controller,
      event: "continuous",
      code: 102,
      value: attack * 2,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard | luaResetPhase | 0x40 },
      operation: () => {},
    });
  };
}
function isKnownMagnificentMachineAngelBattleStartDisableEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaMagnificentMachineAngelCode}:`)) &&
    (effect.event === "continuous" || effect.event === "trigger") &&
    effect.code === 1132 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "battleStarted") &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function magnificentMachineAngelBattleStartDisableOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const battleTargetUid = source?.uid === battle?.attackerUid ? battle?.targetUid : source?.uid === battle?.targetUid ? battle?.attackerUid : undefined;
    const target = battleTargetUid ? ctx.duel.cards.find((card) => card.uid === battleTargetUid) : undefined;
    if (!source || !target || target.previousLocation !== "extraDeck" || target.summonType === undefined) return;
    ctx.duel.effects.push({
      id: `${effect.id}-disable`,
      sourceUid: target.uid,
      controller: effect.controller,
      event: "continuous",
      code: 2,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard | luaResetPhase | luaPhaseBattle },
      operation: () => {},
    });
    ctx.duel.effects.push({
      id: `${effect.id}-disable-effect`,
      sourceUid: target.uid,
      controller: effect.controller,
      event: "continuous",
      code: 8,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard | luaResetPhase | luaPhaseBattle },
      operation: () => {},
    });
  };
}
function mermailAbyssbalaenBattleStartDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const target = battle?.targetUid ? ctx.duel.cards.find((card) => card.uid === battle.targetUid) : undefined;
    if (!target || (target.position !== "faceUpDefense" && target.position !== "faceDownDefense")) return;
    try {
      destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style temporary battle-start triggers do nothing if the target stops being destroyable.
    }
  };
}
function isKnownDivineEvolutionCannotNegateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaDivineEvolutionCode}:`)) &&
    effect.event === "continuous" &&
    (effect.code === 12 || effect.code === 13) &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 0 &&
    effect.reset !== undefined;
}
function isKnownSagaDragonEmperorCannotInactivateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaSagaDragonEmperorCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 12 &&
    effect.sourceUid !== undefined &&
    effect.property === luaEffectFlagClientHint &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    (effect.targetRange === undefined || hasDefaultLuaFieldRange(effect)) &&
    effect.reset?.flags === luaResetsStandardPhaseEnd;
}
function isKnownMachineKing3000BcAttackBoostEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaMachineKing3000BcCode}:`)) &&
    effect.event === "ignition" &&
    effect.sourceUid !== undefined &&
    effect.code === undefined &&
    ((effect.category ?? 0) & luaCategoryAtkChange) !== 0 &&
    effect.countLimit === 1 &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.reset?.flags === luaResetEventStandard;
}
function isKnownClashingSoulsBattledFieldSendEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaClashingSoulsCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1138 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "afterDamageCalculation") &&
    effect.sourceUid !== undefined &&
    (effect.labelObjectUids?.length ?? 0) > 0 &&
    effect.reset?.flags === luaPhaseDamageResetFlags &&
    hasDefaultLuaFieldRange(effect);
}
function isKnownDivineEvolutionAttackAnnounceSendEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:21208154:") || effect.registryKey?.startsWith("lua:62180201:") || effect.registryKey?.startsWith("lua:57793869:")) &&
    effect.event === "trigger" &&
    effect.code === 1130 &&
    effect.triggerEvent === "attackDeclared" &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownOuroborosSageAttackLimitWatcherEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:32281491:")) &&
    effect.event === "continuous" &&
    effect.code === 1130 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "attackDeclared") &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect);
}
function isKnownOuroborosSageAttackDoubleEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:32281491:")) &&
    effect.event === "trigger" &&
    effect.code === 1130 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "attackDeclared") &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone" &&
    effect.reset?.flags === luaResetEventStandard;
}
function isKnownTaiStrikeDamageStepEndEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:86449372:")) &&
    effect.event === "continuous" &&
    effect.code === 1141 &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined;
}
function isKnownGauntletWarriorDamageStepResetEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaGauntletWarriorCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1141 &&
    effect.triggerEvent === "damageStepEnded" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectId !== undefined &&
    effect.reset !== undefined;
}
function isKnownCyberOgreDamageStepResetEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:64268668:")) &&
    effect.event === "continuous" &&
    effect.code === 1141 &&
    effect.triggerEvent === "damageStepEnded" &&
    effect.sourceUid !== undefined &&
    effect.labelObjectId !== undefined &&
    effect.reset !== undefined;
}
function isKnownCastleDarkIllusionsStandbyStatEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:62121:")) &&
    effect.event === "trigger" &&
    effect.code === luaPhaseStandbyEventCode &&
    effect.triggerEvent === "phaseStandby" &&
    effect.sourceUid !== undefined &&
    effect.label !== undefined &&
    effect.labelObjectId !== undefined &&
    effect.reset !== undefined;
}
function isKnownTemporaryMustAttackEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && (effect.code === 191 || (effect.code === 344 && effect.label !== undefined)) && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "monsterZone" && effect.reset !== undefined; }

function isKnownEucalyptusMoleNonEffectBeastAttackBoost(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaEucalyptusMoleCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 100 &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.ownerPlayer !== undefined &&
    effect.targetRange?.[0] === luaLocationMonsterZone &&
    effect.targetRange?.[1] === 0 &&
    effect.value === undefined &&
    effect.luaTargetDescriptor === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.reset.count === 2 &&
    hasDefaultLuaFieldRange(effect);
}

function isKnownCommonSoulOwnerTargetAttackEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaCommonSoulCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 100 &&
    effect.sourceUid !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.property === (luaEffectFlagSingleRange | luaEffectFlagOwnerRelate) &&
    effect.value !== undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange === undefined;
}

function isKnownStatValueEffect(effect: SerializedDuelEffect): boolean { return effect.code !== undefined && [100, 101, 102, 103, 104, 105, 106, 107, 111, 112, 130, 131, 132, 134, 135, 136, 137, 314].includes(effect.code) && (effect.value !== undefined || luaValueDescriptorStatValue(effect.luaValueDescriptor, effect.id) !== undefined); }
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
function isKnownBattleguardRageTargetLeaveSelfDestroyEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaBattleguardRageCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1015 &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone";
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

function isKnownBorreloadExchargeEndPhaseBanishEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith("lua:6247535:")) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    (effect.labelObjectUid !== undefined || (effect.labelObjectUids?.length ?? 0) > 0) &&
    effect.countLimit === 1
  );
}

function isKnownMetaphysRagnarokEndPhaseBanishEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaMetaphysRagnarokCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.label !== undefined &&
    effect.labelObjectUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
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

function isKnownDragodiesEndSearchEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaDragodiesCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownCelestialMagicianEndSearchEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaPerformapalCelestialMagicianCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "phaseEnd") &&
    (effect.triggerCode === undefined || effect.triggerCode === luaPhaseEndEventCode) &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags
  );
}

function isKnownCelestialMagicianTypeBranchEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaPerformapalCelestialMagicianCode}:`)) &&
    effect.event === "continuous" &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    (
      (effect.code === 74 && effect.value === 1 && effect.range.length === 1 && effect.range[0] === "monsterZone") ||
      (effect.code === 6 && effect.targetRange?.[0] === 0 && effect.targetRange?.[1] === 1)
    )
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
    (effect.targetRange === undefined || hasDefaultLuaFieldRange(effect)) &&
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

function isKnownReinforceMonsterEffectImmunity(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaReinforceCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1 &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    effect.targetRange === undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
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
  if (effect.code === 14) return effect.reset?.flags === luaTemporaryPositionLockResetFlags || effect.reset?.flags === luaOpponentTurnPhaseEndResetFlags || isTemporaryRestrictionReset(effect.reset?.flags);
  return effect.code !== undefined && luaStaticSingleCardRestrictionCodes.has(effect.code) && isTemporaryRestrictionReset(effect.reset?.flags);
}

function isTemporaryRestrictionReset(flags: number | undefined): boolean {
  return flags === luaTemporaryRestrictionResetFlags || flags === luaTemporaryRestrictionOpponentResetFlags || flags === luaResetsStandardPhaseEnd || flags === luaResetsStandardOpponentPhaseEnd || flags === luaResetEventStandard;
}

function restoredLuaOperation(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[] = []): DuelEffectDefinition["operation"] {
  if (isKnownYellowAlertDelayedReturnEffect(effect)) return yellowAlertDelayedReturnOperation(effect);
  if (isKnownEngraverOfTheMarkDelayedDestroyEffect(effect)) return engraverOfTheMarkDelayedDestroyOperation(effect);
  if (isKnownLimiterRemovalDelayedDestroyEffect(effect)) return limiterRemovalDelayedDestroyOperation(effect);
  if (isKnownRagingMadPlantsDelayedDestroyEffect(effect)) return ragingMadPlantsDelayedDestroyOperation(effect);
  if (isKnownUnleashYourPowerDelayedSetEffect(effect)) return unleashYourPowerDelayedSetOperation(effect);
  if (isKnownTsumuhaKutsunagiDelayedShuffleEffect(effect)) return tsumuhaKutsunagiDelayedShuffleOperation(effect);
  if (isKnownWakeCupMochaDelayedSendToGraveEffect(effect)) return wakeCupMochaDelayedSendToGraveOperation(effect);
  if (isKnownMetaphysRagnarokEndPhaseBanishEffect(effect)) return luaLabelObjectBanishOperation(effect);
  if (isKnownDelayedSendToHandEffect(effect)) return delayedFlaggedSendToHandOperation(effect);
  if (isKnownDelayedGroupSendToHandEffect(effect)) return delayedGroupSendToHandOperation(effect);
  if (isKnownCalledByTheGraveChainSolvingNegateEffect(effect)) return calledByTheGraveChainSolvingNegateOperation(effect);
  if (isKnownSameOriginalCodeChainSolvingNegateEffect(effect)) return calledByTheGraveChainSolvingNegateOperation(effect);
  if (isKnownGishkiEmiliaTrapNegateEffect(effect)) return gishkiEmiliaTrapNegateOperation(effect);
  if (isKnownRareMetalmorphChainSolvingNegateEffect(effect)) return rareMetalmorphChainSolvingNegateOperation(effect);
  if (isKnownWorldLegacyWhispersSpellNegateEffect(effect)) return worldLegacyWhispersSpellNegateOperation(effect);
  if (isKnownCarpedivemTurnEndHintResetEffect(effect)) return () => {};
  if (isKnownBookOfEclipsePhaseEndEffect(effect)) return bookOfEclipsePhaseEndOperation(effect);
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) return swordsOfRevealingLightPhaseEndOperation();
  if (isKnownOverdoomLineEndPhaseDestroyEffect(effect)) return overdoomLineEndPhaseDestroyOperation(effect);
  if (isKnownMaharaghiPredrawEffect(effect)) return maharaghiPredrawOperation(effect);
  if (isKnownHinoKaguTsuchiPredrawDiscardEffect(effect)) return hinoKaguTsuchiPredrawDiscardOperation(effect);
  if (isKnownSunlitSentinelDelayedStandbyEffect(effect)) return sunlitSentinelDelayedStandbyOperation(effect);
  const assaultZoneOperation = assaultZoneReleaseFlagOperation(effect);
  if (assaultZoneOperation) return assaultZoneOperation;
  if (isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownGrantedSpiritEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownPurushaddollAeonDelayedFlipEffect(effect)) return purushaddollAeonDelayedFlipOperation(effect);
  if (isKnownTemporaryBanishReturnToFieldEffect(effect)) return temporaryBanishReturnToFieldOperation(effect);
  if (isKnownMulcharmyDrawWatcherEffect(effect)) return mulcharmyDrawWatcherOperation(effect);
  if (isKnownMulcharmyEndPhaseShuffleEffect(effect)) return mulcharmyEndPhaseShuffleOperation(effect);
  if (isKnownZeroParadoxDelayedScaleDestroyEffect(effect)) return zeroParadoxDelayedScaleDestroyOperation(effect);
  if (isKnownLevelNormalEndPhaseDestroyEffect(effect)) return levelNormalEndPhaseDestroyOperation(effect);
  if (isKnownDelayedBattleDestroyPhaseEffect(effect)) return delayedBattleDestroyPhaseOperation(effect);
  if (isKnownBorreloadExchargeEndPhaseBanishEffect(effect)) return luaLabelObjectBanishOperation(effect);
  if (isKnownCelestialMagicianEndSearchEffect(effect)) return celestialMagicianEndSearchOperation(effect);
  if (isKnownEbonArrowBattleDestroyingDamageEffect(effect)) return ebonArrowBattleDestroyingDamageOperation(effect);
  if (isKnownMiniGutsBattleDestroyedDamageEffect(effect)) return miniGutsBattleDestroyedDamageOperation(effect);
  if (isKnownSpellbookPowerBattleDestroyingSearchEffect(effect)) return spellbookPowerBattleDestroyingSearchOperation(effect);
  if (isKnownEvolsaurCeratoBattleDestroyingSearchEffect(effect)) return evolsaurCeratoBattleDestroyingSearchOperation(effect);
  if (isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect)) return utopiaEnvoyBattleDestroyingReviveOperation(effect);
  if (isKnownShiranuiSamuraiBattledBanishEffect(effect)) return shiranuiSamuraiBattledBanishOperation(effect);
  if (isKnownAlchemyCycleBattleDestroyedDrawEffect(effect)) return alchemyCycleBattleDestroyedDrawOperation(effect);
  if (isKnownUradoraBattleDestroyingDrawRecoverEffect(effect)) return uradoraBattleDestroyingDrawRecoverOperation(effect);
  if (isKnownPhotonTridentBattleDamageDestroyEffect(effect)) return photonTridentBattleDamageDestroyOperation(effect);
  if (isKnownByeByeDamageBattleDamageReflectEffect(effect)) return byeByeDamageBattleDamageReflectOperation(effect);
  if (isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect)) return byeByeDamageSyntheticBattleDamageReflectOperation(effect);
  if (isKnownDoubleOrNothingBattleStartDoubleEffect(effect)) return doubleOrNothingBattleStartDoubleOperation(effect);
  if (isKnownMagnificentMachineAngelBattleStartDisableEffect(effect)) return magnificentMachineAngelBattleStartDisableOperation(effect);
  if (isKnownMermailAbyssbalaenBattleStartDestroyEffect(effect)) return mermailAbyssbalaenBattleStartDestroyOperation(effect);
  if (isKnownDivineEvolutionAttackAnnounceSendEffect(effect)) return divineEvolutionAttackAnnounceSendOperation(effect);
  if (isKnownOuroborosSageAttackLimitWatcherEffect(effect)) return ouroborosSageAttackLimitWatcherOperation(effect);
  if (isKnownOuroborosSageAttackDoubleEffect(effect)) return ouroborosSageAttackDoubleOperation(effect); if (isKnownShootingcodeTalkerBattlePhaseDrawEffect(effect)) return shootingcodeTalkerBattlePhaseDrawOperation(effect);
  if (isKnownMachineKing3000BcAttackBoostEffect(effect)) return machineKing3000BcAttackBoostOperation(effect);
  if (isKnownArcanaForceMoonStandbyTokenEffect(effect)) return arcanaForceMoonStandbyTokenOperation(effect);
  if (isKnownArcanaForceMoonEndControlEffect(effect)) return arcanaForceMoonEndControlOperation(effect);
  if (isKnownWattcubeIgnitionAttackBoostEffect(effect)) return wattcubeIgnitionAttackBoostOperation(effect);
  if (isKnownClashingSoulsBattledFieldSendEffect(effect)) return clashingSoulsBattledFieldSendOperation(effect);
  if (isKnownPrimePhotonDragonStandbyReviveEffect(effect)) return primePhotonDragonStandbyReviveOperation(effect);
  if (isKnownHunterSevenWeaponsPreDamageEffect(effect)) return hunterSevenWeaponsPreDamageOperation(effect);
  if (isKnownByeByeDamagePreDamageEffect(effect)) return byeByeDamagePreDamageOperation(effect);
  if (isKnownTaiStrikeDamageStepEndEffect(effect)) return taiStrikeDamageStepEndOperation(effect); if (isKnownAssaultSpiritsDamageStepEquipEffect(effect)) return assaultSpiritsDamageStepEquipOperation(effect);
  if (isKnownGauntletWarriorDamageStepResetEffect(effect)) return gauntletWarriorDamageStepResetOperation(effect, snapshotEffects);
  if (isKnownCyberOgreDamageStepResetEffect(effect)) return resetLabelObjectEffectOperation(effect, snapshotEffects);
  if (isKnownCastleDarkIllusionsStandbyStatEffect(effect)) return castleDarkIllusionsStandbyStatOperation(effect);
  if (isKnownPenetrationFusionStage2QuickEffect(effect)) return penetrationFusionStage2AttackOperation(effect);
  if (isKnownParticleFusionCustomAttackEffect(effect)) return particleFusionCustomAttackOperation(effect);
  if (isKnownBattlinBoxerLeadYokeDestroyReplacementEffect(effect)) return () => {};
  if (isKnownDinowrestlerMartialAnkyloEndPhaseSummonEffect(effect)) return dinowrestlerMartialAnkyloEndPhaseSummonOperation(effect);
  if (isKnownEndPhaseReviveDestroyEffect(effect)) return luaHandlerDestroyOperation(effect);
  if (isKnownSelfEndPhaseDestroyEffect(effect)) return selfEndPhaseDestroyOperation(effect);
  if (isKnownSelfEndPhaseSendEffect(effect)) return selfEndPhaseSendOperation(effect);
  if (isKnownSelfEndPhaseReturnToHandEffect(effect)) return selfEndPhaseReturnToHandOperation(effect);
  if (isKnownSelfEndPhaseBanishEffect(effect)) return selfEndPhaseBanishOperation(effect);
  if (isKnownLeaveFieldLinkedDestroyEffect(effect)) return luaLinkedLeaveFieldDestroyOperation(effect);
  if (isKnownEquipLeaveFieldBanishTargetEffect(effect)) return luaEquipLeaveFieldBanishTargetOperation(effect);
  if (isKnownEquipLeaveFieldDestroyTargetEffect(effect)) return luaEquipLeaveFieldDestroyTargetOperation(effect);
  if (isKnownBattleguardRageTargetLeaveSelfDestroyEffect(effect)) return battleguardRageTargetLeaveSelfDestroyOperation(effect);
  if (isKnownDarkMagicExpandedChainingLimitEffect(effect)) return darkMagicExpandedChainingLimitOperation(effect);
  if (isKnownTimeTearingMorganiteSummonLimitEffect(effect)) return timeTearingMorganiteSummonLimitOperation(effect);
  if (isKnownDaiDanceAdjustEffect(effect)) return daiDanceAdjustOperation(effect);
  if (isKnownGagagaGirlXyzAttackZeroTriggerEffect(effect)) return gagagaGirlXyzAttackZeroOperation(effect);
  if (isKnownXyzMaterialAttackGainTriggerEffect(effect)) return xyzMaterialAttackGainOperation(effect);
  if (isKnownTemporaryAttackAnnounceLabelObjectWatcherEffect(effect)) return temporaryAttackAnnounceLabelObjectWatcherOperation(effect);
  if (isKnownTemporaryAttackAnnounceNegateEffect(effect)) return temporaryAttackAnnounceNegateOperation(effect);
  if (isKnownTemporaryBattledSetAttackFinalWatcherEffect(effect)) return temporaryBattledSetAttackFinalWatcherOperation(effect);
  const genericEffect = effect as SerializedDuelEffect;
  if (genericEffect.luaValueDescriptor === luaTemporaryControlReturnDescriptor) {
    const returnPlayer = genericEffect.value === 0 || genericEffect.value === 1 ? genericEffect.value : undefined;
    return luaTemporaryControlReturnOperation(returnPlayer);
  }
  return () => {}; }
function hunterSevenWeaponsPreDamageOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] { return (ctx) => { ctx.duel.effects.push({ id: `${effect.id}-attack-boost`, event: "continuous", code: 100, controller: effect.controller, sourceUid: effect.sourceUid, registryKey: `${effect.registryKey}:attack-boost`, range: ["monsterZone"], reset: { flags: luaResetPhase | 0x40 }, value: 1000, operation: () => {} }); }; }
function isKnownByeByeDamagePreDamageEffect(effect: SerializedDuelEffect | undefined): effect is SerializedDuelEffect {
  return Boolean(effect?.registryKey?.startsWith("lua:20735371:") && effect.event === "quick" && effect.code === 1134 && effect.luaConditionDescriptor === "condition:attack-target-controller:self-no-player-flag:20735371");
}
function overdoomLineEndPhaseDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    if (!source) return;
    const count = (source.turnCounter ?? 0) + 1;
    source.turnCounter = count;
    if (count < 2) return;
    destroyDuelCard(ctx.duel, source.uid, source.controller, duelReason.effect, effect.controller, "graveyard", {
      eventReasonCardUid: effect.sourceUid,
      eventReasonEffectId: Number(effect.id.match(/^lua-(\d+)/)?.[1]),
    });
  };
}
function byeByeDamagePreDamageOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const target = ctx.duel.cards.find((card) => card.uid === battle?.targetUid);
    if (!target || target.controller !== ctx.player || !target.faceUp) return;
    ctx.duel.flagEffects.push({ ownerType: "player", ownerId: String(ctx.player), code: 20735371, reset: 0x40000200, resetCount: 1, property: 0, value: 0, turn: ctx.duel.turn });
    ctx.duel.effects.push({
      id: "lua-2-42",
      registryKey: `${effect.registryKey}:battle-indestructible`,
      event: "continuous",
      code: 42,
      controller: ctx.player,
      sourceUid: target.uid,
      range: ["monsterZone"],
      reset: { flags: 0 },
      value: 1,
      operation: () => {},
    });
    ctx.duel.effects.push({
      id: "lua-3-1143",
      registryKey: `${effect.registryKey}:battle-damage-reflect`,
      event: "continuous",
      code: 1143,
      controller: ctx.player,
      sourceUid: target.uid,
      range: ["monsterZone"],
      reset: { flags: 0 },
      canActivate: (damageCtx) => damageCtx.eventPlayer === ctx.player,
      operation: (damageCtx) => {
        const damage = Math.max(0, Math.floor((damageCtx.eventValue ?? 0) * 2));
        const applied = damageDuelPlayer(damageCtx.duel, otherPlayer(ctx.player), damage, duelReason.effect);
        if (applied <= 0 || damageCtx.duel.status === "ended") return;
        collectDuelTriggerEffects(damageCtx.duel, "damageDealt", undefined, {
          eventPlayer: otherPlayer(ctx.player),
          eventValue: applied,
          eventReason: duelReason.effect,
          eventReasonPlayer: ctx.player,
          eventReasonCardUid: target.uid,
          eventReasonEffectId: 3,
        });
      },
    });
  };
}
function primePhotonDragonStandbyReviveOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    if (ctx.source.location !== "graveyard" || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return;
    const count = (ctx.source.turnCounter ?? 0) + 1;
    ctx.source.turnCounter = count;
    if (count !== 2) return;
    ctx.source.overlayUids = [];
    const summoned = moveDuelCardWithRedirects(ctx.duel, ctx.source.uid, "monsterZone", ctx.player, duelReason.summon | duelReason.specialSummon, ctx.player, {
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
    summoned.faceUp = true;
    summoned.position = "faceUpAttack";
    summoned.summonType = "special";
    delete summoned.summonTypeCode;
    summoned.summonPlayer = ctx.player;
    summoned.summonPhase = ctx.duel.phase;
    summoned.summonMaterialUids = [];
    collectDuelTriggerEffects(ctx.duel, "specialSummoned", summoned);
    ctx.duel.effects.push({
      id: `${effect.id}-set-attack`,
      event: "continuous",
      code: 101,
      controller: effect.controller,
      sourceUid: summoned.uid,
      registryKey: `${effect.registryKey}:set-attack`,
      range: ["monsterZone"],
      reset: { flags: 0x1fe1000 },
      value: currentAttack(summoned, ctx.duel) * 2,
      operation: () => {},
    });
  };
}
function isKnownShootingcodeTalkerBattlePhaseDrawEffect(effect: SerializedDuelEffect): boolean { return Boolean(effect.registryKey?.startsWith("lua:33897356:")) && effect.event === "trigger" && effect.code === 4224 && effect.triggerEvent === "phaseBattle" && effect.sourceUid !== undefined; } function shootingcodeTalkerDestroyedCount(duel: { eventHistory: Array<{ eventName: string; eventReasonCardUid?: string }> }, sourceUid: string | undefined): number { return sourceUid === undefined ? 0 : duel.eventHistory.filter((event) => event.eventName === "battleDestroyed" && event.eventReasonCardUid === sourceUid).length; } function shootingcodeTalkerBattlePhaseDrawOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] { const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]); return (ctx) => { const count = shootingcodeTalkerDestroyedCount(ctx.duel, effect.sourceUid); if (count <= 0) return; drawDuelCards(ctx.duel, effect.controller, count, "Shootingcode Talker draw", { eventReason: duelReason.effect, eventReasonPlayer: effect.controller, eventReasonCardUid: effect.sourceUid, ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}) }); }; }
function isKnownDinowrestlerMartialAnkyloEndPhaseSummonEffect(effect: SerializedDuelEffect): boolean { return Boolean(effect.registryKey?.startsWith(`lua:${luaDinowrestlerMartialAnkyloCode}:`)) && effect.event === "trigger" && effect.code === luaPhaseEndEventCode && effect.triggerEvent === "phaseEnd" && effect.sourceUid !== undefined && effect.range.length === 1 && effect.range[0] === "graveyard"; }
function dinowrestlerMartialAnkyloEndPhaseSummonOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    if (ctx.source.location !== "graveyard" || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return;
    const summoned = moveDuelCardWithRedirects(ctx.duel, ctx.source.uid, "monsterZone", ctx.player, duelReason.summon | duelReason.specialSummon, ctx.player, {
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
    summoned.faceUp = true;
    summoned.position = "faceUpAttack";
    summoned.summonType = "special";
    summoned.summonPlayer = ctx.player;
    summoned.summonPhase = ctx.duel.phase;
    summoned.summonMaterialUids = [];
    collectDuelTriggerEffects(ctx.duel, "specialSummoned", summoned);
    ctx.duel.effects.push({ id: `${effect.id}-redirect`, event: "continuous", code: 60, controller: effect.controller, sourceUid: summoned.uid, registryKey: `${effect.registryKey}:redirect`, property: 0x400, range: ["monsterZone"], reset: { flags: 0xc79000 }, value: 0x20, operation: () => {} });
  };
}
function restoredLuaActivationTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "target"> { if (isKnownGagagaGirlXyzAttackZeroTriggerEffect(effect)) return { target: gagagaGirlXyzAttackZeroTarget() }; if (isKnownPhotonTridentBattleDamageDestroyEffect(effect)) return { target: photonTridentBattleDamageDestroyTarget() }; if (isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect)) return { target: utopiaEnvoyBattleDestroyingReviveTarget(effect) }; if (isKnownLatinumOpponentDiscardReviveEffect(effect)) return { target: latinumOpponentDiscardReviveTarget(effect) }; if (isKnownWattcubeIgnitionAttackBoostEffect(effect)) return { target: wattcubeIgnitionAttackBoostTarget() }; if (isKnownPenetrationFusionStage2QuickEffect(effect)) return { target: penetrationFusionStage2AttackTarget(effect) }; if (isKnownParticleFusionCustomAttackEffect(effect)) return { target: particleFusionCustomAttackTarget(effect) }; if (isKnownBattlinBoxerLeadYokeDestroyReplacementEffect(effect)) return { target: battlinBoxerLeadYokeDestroyReplacementTarget(effect) }; return {}; }

function wattcubeIgnitionAttackBoostTarget(): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const target = ctx.duel.cards.find((card) => card.controller === ctx.player && card.location === "monsterZone" && card.faceUp && (currentRace(card, ctx.duel) & 0x2000) !== 0);
    if (!target) return false;
    if (ctx.checkOnly) return true;
    ctx.targetUids.push(target.uid);
    ctx.operationInfos = [{ category: luaCategoryAtkChange, targetUids: [target.uid], count: 1, player: ctx.player, parameter: 1000 }];
    return true;
  };
}

function wattcubeIgnitionAttackBoostOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const targetUid = ctx.chainLink?.targetUids?.[0] ?? ctx.targetUids[0];
    const target = targetUid ? ctx.duel.cards.find((card) => card.uid === targetUid) : undefined;
    if (!target || target.location !== "monsterZone" || !target.faceUp || (currentRace(target, ctx.duel) & 0x2000) === 0) return;
    ctx.duel.effects.push({
      id: `${effect.id}-attack-boost`,
      event: "continuous",
      code: 100,
      controller: ctx.player,
      sourceUid: target.uid,
      registryKey: `${effect.registryKey}:attack-boost`,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard },
      value: 1000,
      operation: () => {},
    });
  };
}

function battlinBoxerLeadYokeDestroyReplacementTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["target"]> {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    if (ctx.source.location !== "monsterZone" || ctx.source.overlayUids.length < 1) return false;
    if (ctx.checkOnly) return true;
    const detached = detachDuelOverlayMaterials(ctx.duel, ctx.source.uid, 1, ctx.source.controller, duelReason.effect, ctx.player, {
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
    return detached.length === 1;
  };
}

function penetrationFusionStage2AttackTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const target = ctx.duel.cards.find((card) => penetrationFusionStage2AttackTargetFilter(ctx, effect, card));
    if (!target) return false;
    if (ctx.checkOnly) return true;
    ctx.targetUids.push(target.uid);
    ctx.operationInfos = [{ category: luaCategoryAtkChange, targetUids: [target.uid], count: 1, player: ctx.player, parameter: 500 }];
    return true;
  };
}

function penetrationFusionStage2AttackTargetFilter(ctx: DuelEffectContext, effect: SerializedDuelEffect, card: DuelCardInstance): boolean {
  return card.uid !== effect.sourceUid && card.controller === ctx.player && card.location === "monsterZone" && card.faceUp === true;
}

function penetrationFusionStage2AttackOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const targetUid = ctx.chainLink?.targetUids?.[0] ?? ctx.targetUids[0];
    const target = targetUid ? ctx.duel.cards.find((card) => card.uid === targetUid) : undefined;
    if (!target || target.location !== "monsterZone" || !target.faceUp) return;
    ctx.duel.effects.push({
      id: `${effect.id}-attack-boost`,
      event: "continuous",
      code: 100,
      controller: ctx.player,
      sourceUid: target.uid,
      registryKey: `${effect.registryKey}:attack-boost`,
      property: 0x400,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard },
      value: 500,
      operation: () => {},
    });
    ctx.duel.effects = ctx.duel.effects.filter((candidate) => candidate.id !== effect.id || candidate.registryKey !== effect.registryKey);
  };
}

function particleFusionFusionTarget(ctx: DuelEffectContext, effect: SerializedDuelEffect): DuelCardInstance | undefined {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return ctx.duel.cards.find((card) =>
    card.controller === ctx.player &&
    card.location === "monsterZone" &&
    card.faceUp === true &&
    card.summonType === "fusion" &&
    card.reasonCardUid === effect.sourceUid &&
    (!Number.isSafeInteger(reasonEffectId) || card.reasonEffectId === 1) &&
    (card.summonMaterialUids?.length ?? 0) > 0);
}

function particleFusionMaterialTargets(ctx: DuelEffectContext, fusion: DuelCardInstance): DuelCardInstance[] {
  return (fusion.summonMaterialUids ?? [])
    .map((uid) => ctx.duel.cards.find((card) => card.uid === uid))
    .filter((card): card is DuelCardInstance => Boolean(card && currentCardMatchesSetcode(card, ctx.duel, 0x1047)));
}

function particleFusionCustomAttackTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const fusion = particleFusionFusionTarget(ctx, effect);
    const material = fusion ? particleFusionMaterialTargets(ctx, fusion)[0] : undefined;
    if (!fusion || !material) return false;
    if (ctx.checkOnly) return true;
    ctx.targetUids.push(material.uid);
    ctx.operationInfos = [{ category: luaCategoryAtkChange, targetUids: [fusion.uid], count: 1, player: ctx.player, parameter: currentAttack(material, ctx.duel) }];
    return true;
  };
}

function particleFusionCustomAttackOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const fusion = particleFusionFusionTarget(ctx, effect);
    const materialUid = ctx.chainLink?.targetUids?.[0] ?? ctx.targetUids[0];
    const material = materialUid ? ctx.duel.cards.find((card) => card.uid === materialUid) : undefined;
    if (!fusion || !material || fusion.location !== "monsterZone" || !fusion.faceUp || !currentCardMatchesSetcode(material, ctx.duel, 0x1047)) return;
    ctx.duel.effects.push({
      id: `${effect.id}-attack-boost`,
      event: "continuous",
      code: 100,
      controller: ctx.player,
      sourceUid: fusion.uid,
      registryKey: `${effect.registryKey}:attack-boost`,
      property: 0x400,
      range: ["monsterZone"],
      reset: { flags: luaResetsStandardPhaseEnd },
      value: currentAttack(material, ctx.duel),
      operation: () => {},
    });
  };
}

function gauntletWarriorDamageStepResetOperation(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): DuelEffectDefinition["operation"] {
  const defenseBoost = snapshotEffects.find((candidate) => candidate.id.startsWith(`lua-${effect.labelObjectId}-`));
  const attackBoost = snapshotEffects.find((candidate) => candidate.id.startsWith(`lua-${defenseBoost?.labelObjectId}-`));
  const resetIds = new Set([effect.id, defenseBoost?.id, attackBoost?.id].filter((id): id is string => id !== undefined));
  return (ctx) => {
    ctx.duel.effects = ctx.duel.effects.filter((candidate) => !resetIds.has(candidate.id));
  };
}

function resetLabelObjectEffectOperation(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): DuelEffectDefinition["operation"] {
  const labeledEffect = snapshotEffects.find((candidate) => candidate.id.startsWith(`lua-${effect.labelObjectId}-`));
  const resetIds = new Set([effect.id, labeledEffect?.id].filter((id): id is string => id !== undefined));
  return (ctx) => {
    ctx.duel.effects = ctx.duel.effects.filter((candidate) => !resetIds.has(candidate.id));
  };
}

function castleDarkIllusionsStandbyStatOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const nextValue = (effect.label ?? 0) * 200;
    for (const candidate of ctx.duel.effects) {
      if (candidate.sourceUid !== effect.sourceUid) continue;
      if (candidate.code !== 100 && candidate.code !== 104) continue;
      candidate.value = nextValue;
    }
    const liveEffect = ctx.duel.effects.find((candidate) => candidate.id === effect.id);
    if (liveEffect) liveEffect.label = (effect.label ?? 0) + 1;
  };
}

function isKnownLatinumOpponentDiscardReviveEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:15667446:") && effect.event === "trigger" && effect.code === 1014 && effect.triggerEvent === "sentToGraveyard");
}

function latinumOpponentDiscardReviveTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    if (!effect.sourceUid || ctx.source.uid !== effect.sourceUid || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return false;
    const sourcePreviousController = ctx.source.previousController ?? ctx.source.controller;
    const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller;
    if (sourcePreviousController !== ctx.player || reasonPlayer === ctx.player) {
      ctx.operationInfos = [{ category: luaCategorySpecialSummon, targetUids: [ctx.source.uid], count: 1, player: ctx.player, parameter: 0 }];
      return true;
    }
    const target = ctx.duel.cards.find((card) =>
      card.location === "monsterZone" &&
      card.faceUp === true &&
      (currentRace(card, ctx.duel) & luaRaceFiend) !== 0
    );
    if (!target) return false;
    ctx.setTargets([target.uid]);
    ctx.operationInfos = [{ category: luaCategorySpecialSummon, targetUids: [ctx.source.uid], count: 1, player: ctx.player, parameter: 0 }];
    return true;
  };
}

function gagagaGirlXyzAttackZeroTarget(): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const target = ctx.duel.cards
      .filter((card) => card.controller !== ctx.player && card.location === "monsterZone" && card.faceUp)
      .filter((card) => card.summonType !== undefined && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip")
      .sort((a, b) => a.controller - b.controller || a.sequence - b.sequence)[0];
    if (!target) return false;
    ctx.setTargets([target.uid]);
    return true;
  };
}

function photonTridentBattleDamageDestroyTarget(): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const target = ctx.duel.cards
      .filter((card) => card.location === "monsterZone" || card.location === "spellTrapZone")
      .filter((card) => (cardTypeFlags(card, ctx.duel) & 0x6) !== 0)
      .sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence)[0];
    if (!target) return false;
    ctx.setTargets([target.uid]);
    ctx.operationInfos = [{ category: luaCategoryDestroy, targetUids: [target.uid], count: 1, player: ctx.player, parameter: 0 }];
    return true;
  };
}

function divineEvolutionAttackAnnounceSendOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const sendPlayer = otherPlayer(effect.controller);
    const target = ctx.duel.cards
      .filter((card) => card.controller === sendPlayer && card.location === "monsterZone" && (cardTypeFlags(card, ctx.duel) & 0x4000) === 0)
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (!target || !canMoveDuelCardToLocation(ctx.duel, target.uid, "graveyard", duelReason.rule)) return;
    try {
      moveDuelCardWithRedirects(ctx.duel, target.uid, "graveyard", target.controller, duelReason.rule, sendPlayer, {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style restored trigger ignores a target that can no longer be sent.
    }
  };
}

function photonTridentBattleDamageDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const target = ctx.getTargets()[0] ?? ctx.duel.cards
      .filter((card) => card.location === "monsterZone" || card.location === "spellTrapZone")
      .filter((card) => (cardTypeFlags(card, ctx.duel) & 0x6) !== 0)
      .sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence)[0];
    if (!target) return;
    try {
      destroyDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect | duelReason.destroy, ctx.player, "graveyard", {
        eventReasonCardUid: effect.sourceUid,
        ...effectReasonIdPayload(effect),
      });
    } catch {
      // EDOPro-style restored trigger ignores a target that can no longer be destroyed.
    }
  };
}

function celestialMagicianEndSearchOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const target = ctx.duel.cards
      .filter((card) => card.controller === ctx.player && card.location === "deck" && (cardTypeFlags(card, ctx.duel) & 0x1000000) !== 0)
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (!target) return;
    const previous = { controller: target.controller, faceUp: target.faceUp, location: target.location, position: target.position, sequence: target.sequence };
    try {
      moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
      const moved = ctx.duel.cards.find((card) => card.uid === target.uid);
      if (!moved) return;
      const payload = {
        eventPlayer: otherPlayer(ctx.player),
        eventValue: 1,
        eventUids: [moved.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: ctx.player,
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        eventPreviousState: previous,
        eventCurrentState: { controller: moved.controller, faceUp: moved.faceUp, location: moved.location, position: moved.position, sequence: moved.sequence },
      };
      collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [moved], { eventCode: 1211, ...payload });
      collectDuelGroupedTriggerEffects(ctx.duel, "sentToHandConfirmed", [moved], { eventCode: 1212, ...payload });
    } catch {
      // EDOPro-style delayed search ignores cards that can no longer be moved.
    }
  };
}

function ouroborosSageAttackLimitWatcherOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (ctx.duel.turnPlayer !== effect.controller) return;
    ctx.duel.effects.push({
      id: `${effect.id}-cannot-attack-announce`,
      sourceUid: effect.sourceUid,
      controller: effect.controller,
      event: "continuous",
      code: 86,
      property: luaEffectFlagPlayerTarget,
      targetRange: [1, 0],
      range: [...duelLocations],
      reset: { flags: luaPhaseEndResetFlags },
      operation: () => {},
    });
  };
}

function ouroborosSageAttackDoubleOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    const equippedTargetUid = source?.equippedToUid;
    const equippedTarget = equippedTargetUid ? ctx.duel.cards.find((card) => card.uid === equippedTargetUid) : undefined;
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const battleTarget = battle?.targetUid ? ctx.duel.cards.find((card) => card.uid === battle.targetUid) : undefined;
    if (!source || source.location !== "spellTrapZone" || !equippedTarget || !battle || battle.attackerUid !== equippedTarget.uid) return;
    if (!battleTarget || battleTarget.controller === effect.controller) return;
    const attack = currentAttack(equippedTarget, ctx.duel);
    if (attack <= 0) return;
    ctx.duel.effects.push({
      id: `${effect.id}-set-attack-final`,
      sourceUid: equippedTarget.uid,
      controller: effect.controller,
      event: "continuous",
      code: 102,
      value: attack * 2,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard },
      operation: () => {},
    });
  };
}

function taiStrikeDamageStepEndOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const battle = ctx.duel.pendingBattle ?? ctx.duel.currentAttack;
    const deferredDestroyedUids = ctx.duel.pendingBattle?.deferredBattleDestroyed?.map((record) => record.uid) ?? [];
    const uids = [...new Set([
      ...[battle?.attackerUid, battle?.targetUid].filter((uid): uid is string => uid !== undefined),
      ...deferredDestroyedUids,
    ])];
    for (const uid of uids) {
      const card = ctx.duel.cards.find((candidate) => candidate.uid === uid);
      const deferred = ctx.duel.pendingBattle?.deferredBattleDestroyed?.find((record) => record.uid === uid);
      if (!card || (!deferred && card.location !== "graveyard" && card.location !== "banished")) continue;
      const battleDestroyed = ((card.reason ?? 0) & (duelReason.battle | duelReason.destroy)) === (duelReason.battle | duelReason.destroy);
      if (!battleDestroyed && !deferred) continue;
      const damagedPlayer = (card.previousController ?? card.controller) as PlayerId;
      const baseAttack = card.data.attack ?? 0;
      const damage = Math.max(0, Math.floor(baseAttack < 0 ? 0 : baseAttack));
      const applied = damageDuelPlayer(ctx.duel, damagedPlayer, damage, duelReason.effect);
      if (applied <= 0 || ctx.duel.status === "ended") continue;
      collectDuelTriggerEffects(ctx.duel, "damageDealt", undefined, {
        eventPlayer: damagedPlayer,
        eventValue: applied,
        eventReason: duelReason.effect,
        eventReasonPlayer: effect.controller,
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
    }
  };
}

function ebonArrowBattleDestroyingDamageOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const battlePair = latestBattlePairFor(ctx.duel.battlePairs, effect.labelObjectUid);
    const destroyedUid = battlePair ? (battlePair.attackerUid === effect.labelObjectUid ? battlePair.targetUid : battlePair.attackerUid) : undefined;
    const destroyed = destroyedUid ? ctx.duel.cards.find((card) => card.uid === destroyedUid) : ctx.eventCard;
    if (!destroyed) return;
    const damagedPlayer: PlayerId = ctx.player === 0 ? 1 : 0;
    const baseDefense = destroyed.data.defense ?? 0;
    const damage = Math.max(0, Math.floor(baseDefense < 0 ? 0 : baseDefense));
    const applied = damageDuelPlayer(ctx.duel, damagedPlayer, damage, duelReason.effect);
    if (applied <= 0 || ctx.duel.status === "ended") return;
    collectDuelTriggerEffects(ctx.duel, "damageDealt", undefined, {
      eventPlayer: damagedPlayer,
      eventValue: applied,
      eventReason: duelReason.effect,
      eventReasonPlayer: ctx.player,
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}

function latestBattlePairFor(pairs: DuelSession["state"]["battlePairs"], uid: string | undefined): DuelSession["state"]["battlePairs"][number] | undefined {
  if (!uid) return undefined;
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index]!;
    if (pair.attackerUid === uid || pair.targetUid === uid) return pair;
  }
  return undefined;
}

function isKnownCarpedivemTurnEndHintResetEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaExosisterCarpedivemCode}:`)) &&
    effect.event === "continuous" &&
    effect.code === 1210 &&
    (effect.triggerEvent === undefined || effect.triggerEvent === "turnEnded") &&
    (effect.triggerCode === undefined || effect.triggerCode === 1210);
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

function battleguardRageTargetLeaveSelfDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid);
    if (!source || source.location !== "spellTrapZone") return;
    if (!ctx.eventCard || !(source.cardTargetUids ?? []).includes(ctx.eventCard.uid)) return;
    destroyDuelCard(ctx.duel, source.uid, source.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
      eventReasonCardUid: source.uid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}

function byeByeDamageBattleDamageReflectOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    if (ctx.eventPlayer !== effect.controller || ctx.eventValue === undefined || ctx.eventValue <= 0) return;
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    if (!battle?.targetUid || ctx.eventCard?.uid !== battle.targetUid) return;
    const damagedPlayer = otherPlayer(effect.controller);
    const applied = damageDuelPlayer(ctx.duel, damagedPlayer, ctx.eventValue * 2, duelReason.effect);
    if (applied <= 0 || ctx.duel.status === "ended") return;
    collectDuelTriggerEffects(ctx.duel, "damageDealt", undefined, {
      eventPlayer: damagedPlayer,
      eventValue: applied,
      eventReason: duelReason.effect,
      eventReasonPlayer: effect.controller,
      eventReasonCardUid: battle.targetUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}

function byeByeDamageSyntheticBattleDamageReflectOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    if (ctx.eventPlayer !== effect.controller || ctx.eventValue === undefined || ctx.eventValue <= 0) return;
    const applied = damageDuelPlayer(ctx.duel, otherPlayer(effect.controller), ctx.eventValue * 2, duelReason.effect);
    if (applied <= 0 || ctx.duel.status === "ended") return;
    collectDuelTriggerEffects(ctx.duel, "damageDealt", undefined, {
      eventPlayer: otherPlayer(effect.controller),
      eventValue: applied,
      eventReason: duelReason.effect,
      eventReasonPlayer: effect.controller,
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}

function miniGutsBattleDestroyedDamageOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const targetUid = effect.labelObjectUid ?? effect.labelObjectUids?.[0];
    const target = targetUid ? ctx.duel.cards.find((card) => card.uid === targetUid) : undefined;
    if (!target || target.location !== "graveyard" || ((target.reason ?? 0) & duelReason.battle) === 0 || target.owner === ctx.player) return;
    const damagedPlayer: PlayerId = ctx.player === 0 ? 1 : 0;
    const baseAttack = target.data.attack ?? 0;
    const damage = Math.max(0, Math.floor(baseAttack < 0 ? 0 : baseAttack));
    const applied = damageDuelPlayer(ctx.duel, damagedPlayer, damage, duelReason.effect);
    if (applied <= 0 || ctx.duel.status === "ended") return;
    collectDuelTriggerEffects(ctx.duel, "damageDealt", undefined, {
      eventPlayer: damagedPlayer,
      eventValue: applied,
      eventReason: duelReason.effect,
      eventReasonPlayer: ctx.player,
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
  };
}

function spellbookPowerBattleDestroyingSearchOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const target = spellbookPowerSearchTargets(ctx.duel, ctx.player)[0];
    if (!target) return;
    const previous = { controller: target.controller, faceUp: target.faceUp, location: target.location, position: target.position, sequence: target.sequence };
    try {
      moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
      const moved = ctx.duel.cards.find((card) => card.uid === target.uid);
      if (!moved) return;
      const payload = {
        eventPlayer: otherPlayer(ctx.player),
        eventValue: 1,
        eventUids: [moved.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: ctx.player,
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        eventPreviousState: previous,
        eventCurrentState: { controller: moved.controller, faceUp: moved.faceUp, location: moved.location, position: moved.position, sequence: moved.sequence },
      };
      collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [moved], { eventCode: 1211, ...payload });
      collectDuelGroupedTriggerEffects(ctx.duel, "sentToHandConfirmed", [moved], { eventCode: 1212, ...payload });
    } catch {
      // EDOPro-style delayed search ignores cards that can no longer be moved.
    }
  };
}

function spellbookPowerSearchTargets(duel: DuelSession["state"], player: PlayerId): DuelCardInstance[] {
  return duel.cards
    .filter((card) =>
      card.controller === player &&
      card.location === "deck" &&
      currentCardMatchesSetcode(card, duel, luaSetSpellbook) &&
      (cardTypeFlags(card, duel) & luaTypeSpell) !== 0
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function spellbookPowerBattleDestroyingSearchCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => Boolean(
    ctx.eventCard?.uid === effect.labelObjectUid &&
    ctx.duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === effect.labelObjectUid && flag.code === Number(luaSpellbookOfPowerCode)) &&
    spellbookPowerSearchTargets(ctx.duel, ctx.player).length > 0,
  );
}

function evolsaurCeratoBattleDestroyingSearchOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const target = evolsaurCeratoSearchTargets(ctx.duel, ctx.player)[0];
    if (!target) return;
    const previous = { controller: target.controller, faceUp: target.faceUp, location: target.location, position: target.position, sequence: target.sequence };
    try {
      moveDuelCardWithRedirects(ctx.duel, target.uid, "hand", target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
      const moved = ctx.duel.cards.find((card) => card.uid === target.uid);
      if (!moved) return;
      const payload = {
        eventPlayer: otherPlayer(ctx.player),
        eventValue: 1,
        eventUids: [moved.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: ctx.player,
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        eventPreviousState: previous,
        eventCurrentState: { controller: moved.controller, faceUp: moved.faceUp, location: moved.location, position: moved.position, sequence: moved.sequence },
      };
      collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [moved], { eventCode: 1211, ...payload });
      collectDuelGroupedTriggerEffects(ctx.duel, "sentToHandConfirmed", [moved], { eventCode: 1212, ...payload });
    } catch {
      // EDOPro-style restored search ignores cards that can no longer be moved.
    }
  };
}

function evolsaurCeratoSearchTargets(duel: DuelSession["state"], player: PlayerId): DuelCardInstance[] {
  return duel.cards
    .filter((card) =>
      card.controller === player &&
      card.location === "deck" &&
      currentCardMatchesSetcode(card, duel, luaSetEvoltile) &&
      (cardTypeFlags(card, duel) & luaTypeMonster) !== 0
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function evolsaurCeratoBattleDestroyingSearchCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => Boolean(ctx.eventCard?.uid === effect.sourceUid && evolsaurCeratoSearchTargets(ctx.duel, ctx.player).length > 0);
}

function utopiaEnvoyBattleDestroyingReviveTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["target"]> {
  return (ctx) => {
    const target = utopiaEnvoyBattleDestroyedTarget(ctx.duel, effect.sourceUid);
    if (!target || target.location !== "graveyard" || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return false;
    ctx.setTargets([target.uid]);
    ctx.operationInfos = [{ category: luaCategorySpecialSummon, targetUids: [target.uid], count: 1, player: ctx.player, parameter: 0 }];
    return true;
  };
}

function utopiaEnvoyBattleDestroyingReviveCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => Boolean(
    ctx.eventCard?.uid === effect.sourceUid &&
    hasZoneSpace(ctx.duel, ctx.player, "monsterZone") &&
    utopiaEnvoyBattleDestroyedTarget(ctx.duel, effect.sourceUid)?.location === "graveyard",
  );
}

function utopiaEnvoyBattleDestroyedTarget(duel: DuelSession["state"], sourceUid: string | undefined): DuelCardInstance | undefined {
  if (!sourceUid) return undefined;
  for (let index = duel.eventHistory.length - 1; index >= 0; index -= 1) {
    const event = duel.eventHistory[index]!;
    if (event.eventName !== "battleDestroyed" || event.eventReasonCardUid !== sourceUid || !event.eventCardUid) continue;
    const card = duel.cards.find((candidate) => candidate.uid === event.eventCardUid);
    if (card) return card;
  }
  const battlePair = latestBattlePairFor(duel.battlePairs, sourceUid);
  const destroyedUid = battlePair ? (battlePair.attackerUid === sourceUid ? battlePair.targetUid : battlePair.attackerUid) : undefined;
  return destroyedUid ? duel.cards.find((card) => card.uid === destroyedUid) : undefined;
}

function utopiaEnvoyBattleDestroyingReviveOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const target = ctx.getTargets()[0] ?? utopiaEnvoyBattleDestroyedTarget(ctx.duel, effect.sourceUid);
    if (!target || target.location !== "graveyard" || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return;
    const summoned = moveDuelCardWithRedirects(ctx.duel, target.uid, "monsterZone", ctx.player, duelReason.summon | duelReason.specialSummon, ctx.player, {
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    });
    summoned.faceUp = true;
    summoned.position = "faceUpAttack";
    summoned.summonType = "special";
    delete summoned.summonTypeCode;
    summoned.summonPlayer = ctx.player;
    summoned.summonPhase = ctx.duel.phase;
    summoned.summonMaterialUids = [];
    collectDuelTriggerEffects(ctx.duel, "specialSummoned", summoned);
  };
}

function uradoraBattleDestroyingDrawRecoverOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const revealed = ctx.duel.cards.filter((card) => card.controller === ctx.player && card.location === "deck").sort((a, b) => a.sequence - b.sequence)[0];
    if (!revealed) return;
    const reasonPayload = {
      eventReason: duelReason.effect,
      eventReasonPlayer: ctx.player,
      eventReasonCardUid: effect.sourceUid,
      ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
    };
    collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [revealed], {
      eventCode: 1211,
      eventPlayer: ctx.player,
      eventValue: 1,
      eventUids: [revealed.uid],
      ...reasonPayload,
    });
    collectDuelGroupedTriggerEffects(ctx.duel, "confirmed", [revealed], {
      eventCode: 1211,
      eventPlayer: otherPlayer(ctx.player),
      eventValue: 1,
      eventUids: [revealed.uid],
      ...reasonPayload,
    });
    revealed.sequence = 0;
    resequenceDeck(ctx.duel, ctx.player, revealed.uid);
    const race = currentRace(revealed, ctx.duel);
    if ((race & (0x2000 | 0x800 | 0x20000 | 0x800000)) === 0) return;
    const attack = currentAttack(revealed, ctx.duel);
    if (attack < 1000) return;
    const drawCount = Math.floor(attack / 1000);
    const drawn = drawDuelCards(ctx.duel, ctx.player, drawCount, "Uradora of Fate draw", reasonPayload);
    if (drawn <= 0) return;
    const recovered = recoverDuelPlayer(ctx.duel, ctx.player, drawn * 1000);
    if (recovered <= 0) return;
    collectDuelTriggerEffects(ctx.duel, "recoveredLifePoints", undefined, {
      eventCode: 1112,
      eventPlayer: ctx.player,
      eventValue: recovered,
      ...reasonPayload,
    });
  };
}

function resequenceDeck(state: DuelSession["state"], player: PlayerId, priorityUid: string): void {
  const cards = state.cards
    .filter((card) => card.controller === player && card.location === "deck")
    .sort((a, b) => (a.uid === priorityUid ? -1 : b.uid === priorityUid ? 1 : a.sequence - b.sequence));
  for (const [sequence, card] of cards.entries()) card.sequence = sequence;
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

function luaLabelObjectBanishOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const target = effect.labelObjectUid ? ctx.duel.cards.find((card) => card.uid === effect.labelObjectUid) : undefined;
    if (!target || target.location !== "monsterZone") return;
    try {
      banishDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
    } catch {
      // EDOPro-style delayed cleanup ignores targets that can no longer move.
    }
  };
}

function shiranuiSamuraiBattledBanishOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return (ctx) => {
    const pendingBattle = ctx.duel.pendingBattle;
    const battledUid = pendingBattle?.attackerUid === ctx.source.uid ? pendingBattle.targetUid : pendingBattle?.targetUid === ctx.source.uid ? pendingBattle.attackerUid : undefined;
    const target = battledUid ? findCard(ctx.duel, battledUid) : undefined;
    if (!target || target.location !== "monsterZone") return;
    try {
      banishDuelCard(ctx.duel, target.uid, target.controller, duelReason.effect, ctx.player, {
        eventReasonCardUid: effect.sourceUid,
        ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
      });
    } catch {
      // EDOPro-style battled cleanup ignores targets that are no longer removable.
    }
  };
}

function metaphysRagnarokEndPhaseBanishCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    if (effect.label === undefined || ctx.duel.turn !== effect.label) return false;
    const target = effect.labelObjectUid ? ctx.duel.cards.find((card) => card.uid === effect.labelObjectUid) : undefined;
    if (!target || target.location !== "monsterZone") return false;
    return ctx.duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === target.uid && flag.code === Number(luaMetaphysRagnarokCode));
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

function machineKing3000BcAttackBoostOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (ctx.source.location !== "monsterZone" || ctx.source.faceUp !== true) return;
    const value = ctx.chainLink?.effectLabel ?? effect.label;
    if (value === undefined) return;
    const id = nextLuaEffectId(effect, 100);
    ctx.duel.effects.push({
      id,
      sourceUid: ctx.source.uid,
      controller: effect.controller,
      event: "continuous",
      code: 100,
      registryKey: `lua:${luaMachineKing3000BcCode}:${id}`,
      range: ["monsterZone"],
      reset: { flags: luaResetsStandardPhaseEnd },
      value,
      operation: () => {},
    });
  };
}

function arcanaForceMoonStandbyTokenOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (!hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return;
    const sequence = firstOpenMonsterZoneSequence(ctx.duel, ctx.player);
    if (sequence === undefined) return;
    const token: DuelCardInstance = {
      uid: `lua-token-${ctx.player}-97452818-${ctx.duel.cards.length}`,
      code: "97452818",
      name: "Moon Token",
      kind: "monster",
      owner: ctx.player,
      controller: ctx.player,
      location: "monsterZone",
      sequence,
      position: "faceUpAttack",
      overlayUids: [],
      faceUp: true,
      data: { code: "97452818", name: "Moon Token", kind: "monster", typeFlags: luaTypeMonster, level: 1, attack: 0, defense: 0 },
      reason: duelReason.effect,
      reasonPlayer: ctx.player,
      reasonCardUid: effect.sourceUid,
      reasonEffectId: Number(effect.id.match(/^lua-(\d+)/)?.[1]),
    };
    ctx.duel.cards.push(token);
    pushDuelLog(ctx.duel, "specialSummon", ctx.player, token.name, "Special Summoned by restored Arcana Force XVIII - The Moon");
    collectDuelTriggerEffects(ctx.duel, "specialSummoned", token, {
      eventReason: duelReason.effect,
      eventReasonPlayer: ctx.player,
      eventReasonCardUid: effect.sourceUid,
      eventReasonEffectId: token.reasonEffectId,
    });
  };
}

function arcanaForceMoonEndControlOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const uid = ctx.targetUids[0] ?? ctx.duel.cards.find((card) => card.controller === ctx.player && card.location === "monsterZone")?.uid;
    const target = uid ? ctx.duel.cards.find((card) => card.uid === uid) : undefined;
    if (!target || target.location !== "monsterZone") return;
    const targetPlayer = ctx.player === 0 ? 1 : 0;
    if (isControlChangePrevented(ctx.duel, target, createLuaMaterialCheckContext(ctx.duel))) return;
    if (!hasZoneSpace(ctx.duel, targetPlayer, "monsterZone")) return;
    const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
    moveDuelCardWithRedirects(ctx.duel, target.uid, "monsterZone", targetPlayer, duelReason.effect, ctx.player, {
      eventReasonCardUid: effect.sourceUid,
      eventReasonEffectId: reasonEffectId,
    });
    collectDuelTriggerEffects(ctx.duel, "controlChanged", target, {
      eventReason: duelReason.effect,
      eventReasonPlayer: ctx.player,
      eventReasonCardUid: effect.sourceUid,
      eventReasonEffectId: reasonEffectId,
    });
  };
}

function firstOpenMonsterZoneSequence(state: DuelSession["state"], player: PlayerId): number | undefined {
  const used = new Set(state.cards.filter((card) => card.controller === player && card.location === "monsterZone").map((card) => card.sequence));
  for (let sequence = 0; sequence < 5; sequence += 1) {
    if (!used.has(sequence)) return sequence;
  }
  return undefined;
}

function clashingSoulsBattledFieldSendOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const battledControllers = new Set<PlayerId>();
    const activeBattle = ctx.duel.pendingBattle ?? ctx.duel.currentAttack;
    const fallbackBattleUids = [activeBattle?.attackerUid, activeBattle?.targetUid].filter((uid): uid is string => Boolean(uid));
    const battleUids = (effect.labelObjectUids?.length ?? 0) >= 2 ? effect.labelObjectUids ?? [] : (ctx.eventUids && ctx.eventUids.length >= 2 ? ctx.eventUids : fallbackBattleUids);
    const labelCards = battleUids.map((uid) => ctx.duel.cards.find((candidate) => candidate.uid === uid)).filter((card): card is DuelCardInstance => Boolean(card));
    for (const uid of effect.labelObjectUids ?? []) {
      const card = ctx.duel.cards.find((candidate) => candidate.uid === uid);
      if (card?.location === "graveyard" && ((card.reason ?? 0) & duelReason.battle) !== 0) battledControllers.add(card.controller);
    }
    if (battledControllers.size === 0 && labelCards.length === 2) {
      const first = labelCards[0]!;
      const second = labelCards[1]!;
      const firstAttack = currentAttack(first, ctx.duel);
      const secondAttack = currentAttack(second, ctx.duel);
      if (firstAttack <= secondAttack) battledControllers.add(first.controller);
      if (secondAttack <= firstAttack) battledControllers.add(second.controller);
    }
    if (battledControllers.size === 0 && labelCards.length === 1) {
      const card = labelCards[0]!;
      battledControllers.add(card.controller);
      battledControllers.add(card.controller === 0 ? 1 : 0);
    }
    if (battledControllers.size === 1 && labelCards.length > 0) {
      battledControllers.add(battledControllers.has(0) ? 1 : 0);
    }
    if (battledControllers.size === 0) return;
    const moved: string[] = [];
    const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
    for (const card of [...ctx.duel.cards].sort((a, b) => a.controller - b.controller || a.sequence - b.sequence)) {
      if (!battledControllers.has(card.controller) || (card.location !== "monsterZone" && card.location !== "spellTrapZone")) continue;
      try {
        sendDuelCardToGraveyard(ctx.duel, card.uid, card.controller, duelReason.effect, effect.controller, {
          eventReasonCardUid: effect.sourceUid,
          ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
        });
        moved.push(card.uid);
      } catch {
        // EDOPro-style group sends ignore cards that can no longer move.
      }
    }
    if (moved.length > 1) {
      const movedCards = moved.map((uid) => ctx.duel.cards.find((card) => card.uid === uid && card.location === "graveyard")).filter((card): card is DuelCardInstance => Boolean(card));
      collectDuelGroupedTriggerEffects(ctx.duel, "sentToGraveyard", movedCards, { eventUids: moved });
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
  if (isKnownReinforceMonsterEffectImmunity(effect)) {
    return {
      valuePredicate: (ctx) => {
        const relatedEffect = relatedEffectFromContext(ctx);
        const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
        return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && relatedEffect?.controller !== effect.controller);
      },
    };
  }
  if (effect.luaValueDescriptor === "immune-effect:opponent-card-effects") {
    return {
      valuePredicate: (ctx) => {
        const relatedEffect = relatedEffectFromContext(ctx);
        return relatedEffect !== undefined && (relatedEffect.ownerPlayer ?? relatedEffect.controller) !== (effect.ownerPlayer ?? effect.controller);
      },
    };
  }
  if (effect.luaValueDescriptor === "immune-effect:monster-effects") {
    return {
      valuePredicate: (ctx) => {
        const relatedEffect = relatedEffectFromContext(ctx);
        const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
        return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0);
      },
    };
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
  if (isKnownCannotSelectBattleTargetNotHandlerEffect(effect)) {
    return { valueCardPredicate: (_ctx, card) => card.uid !== effect.sourceUid };
  }
  if (effect.luaValueDescriptor === "value-card:not-facedown") return { valueCardPredicate: (_ctx, card) => card.faceUp || !String(card.position).toLowerCase().includes("facedown") };
  if (effect.luaValueDescriptor === "value-card:label-object") return { valueCardPredicate: (_ctx, card) => effect.labelObjectUid === undefined || card.uid === effect.labelObjectUid };
  if (effect.luaValueDescriptor?.startsWith("value-card:race:")) return { valueCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) !== 0 };
  if (effect.luaValueDescriptor?.startsWith("value-card:attribute:")) return { valueCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) !== 0 };
  if (effect.luaValueDescriptor === luaCannotActivateSpecialSummonedMonsterDescriptor) {
    return { valuePredicate: (ctx) => relatedEffectIsSpecialSummonedMonsterOnField(ctx) };
  }
  if (effect.luaValueDescriptor === luaCannotActivateNonSpiritMonsterDescriptor) return { valuePredicate: (ctx) => relatedEffectIsNonSpiritMonsterEffect(ctx) };
  if (isKnownCelestialMagicianTypeBranchEffect(effect) && effect.code === 6) return { valuePredicate: (ctx) => Boolean(relatedEffectFromContext(ctx)?.luaTypeFlags !== undefined && ((relatedEffectFromContext(ctx)?.luaTypeFlags ?? 0) & luaTypeMonster) !== 0) };
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
  if (isKnownTemporaryPlayerHalfBattleDamageEffect(effect)) return { battleDamageValue: (_ctx, player) => effect.targetRange?.[player] ? luaHalfDamage : undefined };
  if (isKnownTargetScopedHalfBattleDamageEffect(effect)) return { battleDamageValue: (_ctx, player) => player !== effect.controller ? luaHalfDamage : undefined };
  if (isKnownLifeHackOpponentHalfBattleDamageEffect(effect)) return { battleDamageValue: (_ctx, player) => player !== effect.controller ? luaHalfDamage : undefined };
  if (effect.luaValueDescriptor !== "change-damage:effect-double" && effect.luaValueDescriptor !== "change-damage:effect-zero") return {};
  const applyValue = (ctx: Parameters<NonNullable<DuelEffectDefinition["lifePointValue"]>>[0], _player: PlayerId, amount: number): number => ((ctx.eventReason ?? 0) & duelReason.effect) !== 0 ? (effect.luaValueDescriptor === "change-damage:effect-double" ? amount * 2 : 0) : amount;
  return { battleDamageValue: applyValue, lifePointValue: applyValue };
}

function commonSoulOwnerTargetAttackCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    if (!effect.sourceUid || !effect.labelObjectUid || ctx.source.uid !== effect.sourceUid) return false;
    return ctx.duel.cards.some((card) =>
      card.code === luaCommonSoulCode &&
      card.location === "spellTrapZone" &&
      card.faceUp === true &&
      card.cardTargetUids?.includes(effect.sourceUid!) === true &&
      card.cardTargetUids.includes(effect.labelObjectUid!),
    );
  };
}

function hasCardFlag(ctx: DuelEffectContext, uid: string | undefined, code: number): boolean {
  return uid !== undefined && ctx.duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === uid && flag.code === code);
}

function overdoomLineAttackBoostTarget(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["targetCardPredicate"]> {
  return (ctx, card) => Boolean(effect.labelObjectUids?.includes(card.uid) && hasCardFlag(ctx, card.uid, Number(luaOverdoomLineCode)));
}

function mirrorWallAttackHalveCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "statValue" | "targetCardPredicate"> {
  return {
    targetCardPredicate: (ctx, card) => Boolean(effect.labelObjectUids?.includes(card.uid) && ctx.duel.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === card.uid && flag.code === Number(luaMirrorWallCode))),
    statValue: (ctx, card) => Math.floor(currentAttackWithoutEffect(card, ctx.duel, effect.id) / 2),
  };
}

function restoredLuaConditionCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "canActivate"> {
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) {
    return { canActivate: swordsOfRevealingLightPhaseEndCanActivate(effect) };
  }
  if (isKnownBookOfEclipsePhaseEndEffect(effect)) return { canActivate: bookOfEclipsePhaseEndCanActivate(effect) };
  if (isKnownMaharaghiPredrawEffect(effect)) return { canActivate: (ctx) => ctx.duel.turnPlayer === effect.controller && topDeckCards(ctx.duel, effect.controller).length > 0 };
  if (isKnownLevelNormalEndPhaseDestroyEffect(effect)) return { canActivate: levelNormalEndPhaseDestroyCanActivate(effect) };
  if (isKnownEngraverOfTheMarkDelayedDestroyEffect(effect)) return { canActivate: engraverOfTheMarkDelayedDestroyCanActivate(effect) };
  if (isKnownPurushaddollAeonDelayedFlipEffect(effect)) return { canActivate: purushaddollAeonDelayedFlipCanActivate(effect) };
  const temporaryBanishReturnCondition = temporaryBanishReturnToFieldCanActivate(effect);
  if (temporaryBanishReturnCondition) return { canActivate: temporaryBanishReturnCondition };
  if (isKnownMetaphysRagnarokEndPhaseBanishEffect(effect)) return { canActivate: metaphysRagnarokEndPhaseBanishCanActivate(effect) };
  if (isKnownPhotonTridentBattleDamageDestroyEffect(effect)) return { canActivate: (ctx) => ctx.eventPlayer === otherPlayer(effect.controller) && ctx.eventCard?.uid === effect.labelObjectUid };
  if (isKnownSpellbookPowerBattleDestroyingSearchEffect(effect)) return { canActivate: spellbookPowerBattleDestroyingSearchCanActivate(effect) };
  if (isKnownEvolsaurCeratoBattleDestroyingSearchEffect(effect)) return { canActivate: evolsaurCeratoBattleDestroyingSearchCanActivate(effect) };
  if (isKnownUtopiaEnvoyBattleDestroyingReviveEffect(effect)) return { canActivate: utopiaEnvoyBattleDestroyingReviveCanActivate(effect) };
  if (isKnownAlchemyCycleBattleDestroyedDrawEffect(effect)) return alchemyCycleBattleDestroyedDrawConditionCallbacks(effect);
  if (isKnownUradoraBattleDestroyingDrawRecoverEffect(effect)) return { canActivate: (ctx) => ctx.eventCard?.uid === effect.labelObjectUid && topDeckCards(ctx.duel, effect.controller).length > 0 };
  if (isKnownCommonSoulOwnerTargetAttackEffect(effect)) return { canActivate: commonSoulOwnerTargetAttackCanActivate(effect) };
  if (isKnownOverdoomLineAttackBoostEffect(effect)) return { canActivate: (ctx) => hasCardFlag(ctx, effect.sourceUid, Number(luaOverdoomLineCode)) };
  if (isKnownDelayedBattleDestroyPhaseEffect(effect)) {
    return { canActivate: delayedBattleDestroyPhaseCanActivate(effect) };
  }
  const skipBattleCondition = temporarySelfTurnSkipBattlePhaseCanActivate(effect); if (skipBattleCondition) return { canActivate: skipBattleCondition };
  const skipMain1Condition = temporaryOpponentTurnSkipMain1CanActivate(effect); if (skipMain1Condition) return { canActivate: skipMain1Condition };
  const assaultZoneConditionCallbacks = assaultZoneReleaseFlagConditionCallbacks(effect);
  if (assaultZoneConditionCallbacks.canActivate) return assaultZoneConditionCallbacks;
  if (effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor) return { canActivate: (ctx) => ctx.source.controller === effect.controller };
  if (effect.luaConditionDescriptor?.startsWith("condition:attack-target-controller:self-no-player-flag:")) return { canActivate: (ctx) => {
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const target = ctx.duel.cards.find((card) => card.uid === battle?.targetUid);
    const flagCode = Number(effect.luaConditionDescriptor?.split(":").pop());
    return Boolean(target?.controller === ctx.player && !ctx.duel.flagEffects.some((flag) => flag.ownerType === "player" && flag.ownerId === String(ctx.player) && flag.code === flagCode));
  } };
  if (effect.luaConditionDescriptor?.startsWith("condition:battle-phase-own-code-battler:")) return { canActivate: (ctx) => {
    if (ctx.duel.phase !== "battle") return false;
    const code = String(effect.luaConditionDescriptor?.split(":").pop() ?? "");
    const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle;
    const attacker = ctx.duel.cards.find((card) => card.uid === battle?.attackerUid);
    const target = ctx.duel.cards.find((card) => card.uid === battle?.targetUid);
    return Boolean((attacker?.controller === ctx.player && attacker.faceUp && attacker.code === code) || (target?.controller === ctx.player && target.faceUp && target.code === code));
  } };
  if (isKnownByeByeDamageSyntheticBattleDamageReflectEffect(effect)) return { canActivate: (ctx) => ctx.eventPlayer === effect.controller };
  if (isKnownHunterSevenWeaponsPreDamageEffect(effect)) return { canActivate: (ctx) => { const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const targetUid = ctx.source.uid === battle?.attackerUid ? battle.targetUid : ctx.source.uid === battle?.targetUid ? battle.attackerUid : undefined; const target = ctx.duel.cards.find((card) => card.uid === targetUid); return Boolean(ctx.source.location === "monsterZone" && target && effect.label !== undefined && (currentRace(target, ctx.duel) & effect.label) !== 0); } }; if (isKnownShootingcodeTalkerBattlePhaseDrawEffect(effect)) return { canActivate: (ctx) => shootingcodeTalkerDestroyedCount(ctx.duel, effect.sourceUid) > 0 };
  if (isKnownAssaultSpiritsDamageStepEquipEffect(effect)) return { canActivate: assaultSpiritsDamageStepEquipCondition() }; if (effect.luaConditionDescriptor === luaNotDrawPhaseConditionDescriptor) return { canActivate: (ctx) => ctx.duel.phase !== "draw" };
  if (effect.luaConditionDescriptor === luaSourceEquippedConditionDescriptor) return { canActivate: (ctx) => ctx.source.equippedToUid !== undefined };
  if (effect.luaConditionDescriptor === "condition:chain-solving-monster-effect-handler-original-code-label") return { canActivate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaConditionDescriptor === "condition:chain-solving-effect-handler-original-code-label") return { canActivate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaConditionDescriptor === "condition:event-player:opponent") return { canActivate: (ctx) => ctx.eventPlayer === otherPlayer(effect.controller) };
  if (effect.luaConditionDescriptor === "condition:event-player:self") return { canActivate: (ctx) => ctx.eventPlayer === effect.controller };
  if (effect.luaConditionDescriptor === "condition:event-group-opponent-extra-deck-special-summon") return { canActivate: (ctx) => Boolean(ctx.eventCard?.summonPlayer === otherPlayer(effect.controller) && ctx.eventCard.summonType && locationMatchesCardMask(ctx.eventCard, 0x40, ctx.eventCard.previousLocation, ctx.eventCard.previousSequence)) };
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
  if (effect.luaConditionDescriptor?.startsWith("condition:event-previous-controller-previous-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; const card = ctx.eventCard; return Boolean(card?.previousController === effect.controller && card.previousLocation && locationMatchesCardMask(card, Number(location), card.previousLocation, card.previousSequence) && (((ctx.eventReason ?? card.reason) ?? 0) & Number(reason)) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-summon-location:")) return { canActivate: (ctx) => Boolean(ctx.source.summonType && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-not:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) === 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all-player:")) return { canActivate: (ctx) => { const [, , location, reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const mask = Number(reason); const sourceReason = (ctx.eventReason ?? ctx.source.reason) ?? 0; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (sourceReason & mask) === mask && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; const mask = Number(reason); return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & mask) === mask); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-location:")) return { canActivate: (ctx) => Boolean(ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason-player-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0 && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-position:")) return { canActivate: (ctx) => { const [, , previous, current] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(previous)) !== 0 && (positionMaskFromPosition(ctx.source.position) & Number(current)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location-reason:")) return { canActivate: (ctx) => { const [, , position, location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && locationMatchesCardMask(ctx.source, Number(location)) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location:")) return { canActivate: (ctx) => { const [, , position, location] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position-reason:")) return { canActivate: (ctx) => { const [, , position, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(position)) !== 0 && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-position:")) return { canActivate: (ctx) => Boolean(ctx.source.previousPosition && (positionMaskFromPosition(ctx.source.previousPosition) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0) };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && locationMatchesCardMask(ctx.source, Number(location)) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-side-previous-location:")) return { canActivate: (ctx) => { const [, , location, side] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller) && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason-player:")) return { canActivate: (ctx) => { const [, , location, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller)); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason:")) return { canActivate: (ctx) => { const [, , location, reason] = effect.luaConditionDescriptor?.split(":") ?? []; return Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(location), ctx.source.previousLocation, ctx.source.previousSequence) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0); } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location:")) return { canActivate: (ctx) => Boolean(ctx.source.previousController === effect.controller && ctx.source.previousLocation && locationMatchesCardMask(ctx.source, Number(effect.luaConditionDescriptor?.split(":").pop()), ctx.source.previousLocation, ctx.source.previousSequence)) }; if (effect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-reason-player-reason:")) return { canActivate: (ctx) => { const [, , reason, side] = effect.luaConditionDescriptor?.split(":") ?? []; const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return ctx.source.previousController === effect.controller && reasonPlayer === (side === "opponent" ? otherPlayer(effect.controller) : effect.controller) && (((ctx.eventReason ?? ctx.source.reason) ?? 0) & Number(reason)) !== 0; } }; if (effect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent") return { canActivate: (ctx) => { const reasonPlayer = ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller; return ctx.source.previousController === effect.controller && reasonPlayer === otherPlayer(effect.controller); } }; if (effect.luaConditionDescriptor === "condition:source-previous-controller") return { canActivate: (ctx) => ctx.source.previousController === effect.controller };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-not:")) return { canActivate: (ctx) => ((ctx.eventReason ?? ctx.source.reason ?? 0) & Number(effect.luaConditionDescriptor?.split(":").pop())) === 0 }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-all:")) return { canActivate: (ctx) => { const mask = Number(effect.luaConditionDescriptor?.split(":").pop()); return ((ctx.eventReason ?? ctx.source.reason ?? 0) & mask) === mask; } }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason:")) return { canActivate: (ctx) => ((ctx.eventReason ?? ctx.source.reason ?? 0) & Number(effect.luaConditionDescriptor?.split(":").pop())) !== 0 }; if (effect.luaConditionDescriptor?.startsWith("condition:source-reason-player:")) return { canActivate: (ctx) => (ctx.eventReasonPlayer ?? ctx.source.reasonPlayer ?? ctx.source.controller) === (effect.luaConditionDescriptor?.endsWith(":opponent") === true ? otherPlayer(effect.controller) : effect.controller) };
  if (effect.luaConditionDescriptor === "condition:source-overlay-count-positive") return { canActivate: (ctx) => ctx.source.overlayUids.length > 0 }; if (effect.luaConditionDescriptor === "condition:source-overlay-count-zero") return { canActivate: (ctx) => ctx.source.overlayUids.length === 0 };
  if (effect.luaConditionDescriptor?.startsWith("condition:source-overlay-has-attribute:")) return { canActivate: (ctx) => {
    const attribute = Number(effect.luaConditionDescriptor?.split(":").pop());
    return ctx.source.overlayUids.some((uid) => {
      const material = findCard(ctx.duel, uid);
      return Boolean(material && (currentAttribute(material, ctx.duel) & attribute) !== 0);
    });
  } };
  return {};
}
function restoredLuaCostCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "cost"> {
  const summonTypeNot = specialSummonTypeNotCostDescriptor(effect.luaCostDescriptor);
  const summonTypeIs = specialSummonTypeIsCostDescriptor(effect.luaCostDescriptor);
  if (summonTypeNot !== undefined) return { cost: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== summonTypeNot };
  if (summonTypeIs !== undefined) return { cost: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === summonTypeIs };
  if (isKnownGaapRevealFiendAttackBoostEffect(effect)) return { cost: (ctx) => revealHandRaceCost(ctx, luaRaceFiend, 1, 63) };
  if (effect.luaCostDescriptor === "cost:self-to-grave" || isKnownWattcubeIgnitionAttackBoostEffect(effect)) return { cost: (ctx) => luaSelfToGraveCost(ctx, effect) };
  if (effect.luaCostDescriptor === "cost:self-tribute") return { cost: (ctx) => luaSelfTributeCost(ctx, effect) };
  if (isKnownMachineKing3000BcAttackBoostEffect(effect)) return { cost: (ctx) => machineKing3000BcReleaseCost(ctx, effect) };
  if (effect.luaCostDescriptor === "cost:release-linked-group-not-battle-destroyed") return { cost: (ctx) => releaseLinkedGroupNotBattleDestroyedCost(ctx, effect) }; if (isKnownAssaultSpiritsDamageStepEquipEffect(effect)) return { cost: assaultSpiritsDamageStepEquipCost(effect) };
  return {};
}

function isKnownGaapRevealFiendAttackBoostEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:37955049:") && effect.event === "ignition" && effect.sourceUid !== undefined);
}

function revealHandRaceCost(ctx: DuelEffectContext, race: number, min: number, max: number): boolean {
  const selectable = ctx.duel.cards.filter((card) =>
    card.controller === ctx.player &&
    card.location === "hand" &&
    !card.faceUp &&
    (currentRace(card, ctx.duel) & race) !== 0
  );
  if (selectable.length < min) return false;
  if (ctx.checkOnly) return true;
  ctx.effectLabel = selectable.slice(0, max).length;
  return true;
}

function luaSelfToGraveCost(ctx: DuelEffectContext, effect: SerializedDuelEffect): boolean {
  if (!canMoveDuelCardToLocation(ctx.duel, ctx.source.uid, "graveyard", duelReason.cost)) return false;
  if (ctx.checkOnly) return true;
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.cost, ctx.player, {
    eventReasonCardUid: ctx.source.uid,
    ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
  });
  return true;
}

function luaSelfTributeCost(ctx: DuelEffectContext, effect: SerializedDuelEffect): boolean {
  if (ctx.source.location !== "monsterZone" || !canMoveDuelCardToLocation(ctx.duel, ctx.source.uid, "graveyard", duelReason.release | duelReason.cost)) return false;
  if (ctx.checkOnly) return true;
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.source.controller, duelReason.release | duelReason.cost, ctx.player, {
    eventReasonCardUid: ctx.source.uid,
    ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
  });
  if (isKnownPenetrationFusionStage2QuickEffect(effect) && !ctx.duel.effects.some((candidate) => candidate.registryKey === effect.registryKey)) {
    ctx.duel.effects.push({
      ...effect,
      range: restoredLuaEffectRange(effect),
      ...(effect.reset ? { reset: { ...effect.reset } } : {}),
      ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
      cost: (next) => luaSelfTributeCost(next, effect),
      target: penetrationFusionStage2AttackTarget(effect),
      operation: penetrationFusionStage2AttackOperation(effect),
    });
  }
  return true;
}


function machineKing3000BcReleaseCost(ctx: DuelEffectContext, effect: SerializedDuelEffect): boolean {
  const release = ctx.duel.cards.find((card) =>
    card.uid !== ctx.source.uid &&
    card.controller === ctx.player &&
    card.location === "monsterZone" &&
    (currentRace(card, ctx.duel) & luaRaceMachine) !== 0 &&
    canMoveDuelCardToLocation(ctx.duel, card.uid, "graveyard", duelReason.release | duelReason.cost)
  );
  if (!release) return false;
  if (ctx.checkOnly) return true;
  ctx.effectLabel = currentAttack(release, ctx.duel);
  const reasonEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  sendDuelCardToGraveyard(ctx.duel, release.uid, release.controller, duelReason.release | duelReason.cost, ctx.player, {
    eventReasonCardUid: ctx.source.uid,
    ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
  });
  return true;
}

function releaseLinkedGroupNotBattleDestroyedCost(ctx: DuelEffectContext, effect: SerializedDuelEffect): boolean {
  const linked = linkedGroupUidsForCard({ state: ctx.duel } as DuelSession, ctx.source)
    .map((uid) => ctx.duel.cards.find((card) => card.uid === uid))
    .filter((card): card is DuelCardInstance => Boolean(card && card.controller === ctx.player && card.location === "monsterZone" && ((card.customStatusMask ?? 0) & 0x4000) === 0));
  const release = linked[0];
  if (!release) return false;
  if (ctx.checkOnly) return true;
  const reasonEffectId = Number((ctx.chainLink?.effectId ?? effect.id).match(/^lua-(\d+)/)?.[1]);
  sendDuelCardToGraveyard(ctx.duel, release.uid, release.controller, duelReason.release | duelReason.cost, ctx.player, {
    eventReasonCardUid: ctx.source.uid,
    ...(Number.isSafeInteger(reasonEffectId) ? { eventReasonEffectId: reasonEffectId } : {}),
  });
  return true;
}
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
function luaScriptRegistryKeys(registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[], source: LuaScriptSource): Set<string> {
  const scriptKeys = new Set<string>();
  const effectsByRegistryKey = new Map<string, SerializedDuelEffect[]>();
  for (const effect of snapshotEffects) {
    if (!effect.registryKey || !registryKeys.has(effect.registryKey)) continue;
    const effects = effectsByRegistryKey.get(effect.registryKey) ?? [];
    effects.push(effect);
    effectsByRegistryKey.set(effect.registryKey, effects);
  }
  for (const key of registryKeys) {
    const effects = effectsByRegistryKey.get(key) ?? [];
    if (
      effects.length === 0 ||
      effects.some((effect) => !isKnownRestorableLuaEffect(effect, snapshotEffects)) ||
      effects.some((effect) => isKnownChangeCodeEffect(effect) && registryKeyScriptExists(source, key))
    ) {
      scriptKeys.add(key);
    }
  }
  return scriptKeys;
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> { return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:")))); }
function registryKeyScriptExists(source: LuaScriptSource, key: string): boolean {
  const [, code] = key.split(":");
  return Boolean(code && /^\d+$/.test(code) && cardMetadataScriptExists(source, `c${code}.lua`));
}
function luaRestoreIncompleteReasons(loadedScripts: LuaScriptLoadResult[], missingRegistryKeys: string[], missingChainLimitRegistryKeys: string[]): string[] {
  return [
    ...loadedScripts.filter((result) => !result.ok).map((result) => `script ${result.name}: ${result.error}`),
    ...(missingRegistryKeys.length === 0 ? [] : [`missing Lua effect registry keys: ${missingRegistryKeys.join(", ")}`]),
    ...(missingChainLimitRegistryKeys.length === 0 ? [] : [`missing Lua chain-limit registry keys: ${missingChainLimitRegistryKeys.join(", ")}`]),
  ];
}
function luaRestoreIncompleteError(restored: LuaSnapshotRestoreResult): string { return restored.incompleteReasons.length === 0 ? "Lua snapshot restore is incomplete" : `Lua snapshot restore is incomplete: ${restored.incompleteReasons.join("; ")}`; }
