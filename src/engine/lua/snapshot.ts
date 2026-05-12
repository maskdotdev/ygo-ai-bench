import { findCard, hasZoneSpace } from "#duel/card-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentRace } from "#duel/card-stats.js";
import { applyResponse, canMoveDuelCardToLocation, canPlayerSpecialSummon, collectDuelGroupedTriggerEffects, getGroupedDuelLegalActions, getLegalActions, moveDuelCardWithRedirects, queryPublicState } from "#duel/core.js"; import { isControlChangePrevented } from "#duel/continuous-effects.js"; import { currentBattleStep } from "#duel/battle-window-state.js";
import { duelReason } from "#duel/reasons.js";
import { effectiveSpecialSummonTypeCode, isSummonTypeMaskMatch, luaSummonTypeRitual, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { cardFieldId } from "#duel/card-field-id.js";
import { bookOfEclipsePhaseEndCanActivate, bookOfEclipsePhaseEndOperation, isKnownBookOfEclipsePhaseEndEffect } from "#lua/snapshot-book-of-eclipse.js";
import { isKnownUnleashYourPowerDelayedSetEffect, isKnownYellowAlertDelayedReturnEffect, unleashYourPowerDelayedSetOperation, yellowAlertDelayedReturnOperation } from "#lua/snapshot-delayed-operations.js";
import { isKnownSwordsOfRevealingLightPhaseEndEffect, isKnownSwordsOfRevealingLightResetEffect, swordsOfRevealingLightPhaseEndCanActivate, swordsOfRevealingLightPhaseEndOperation, swordsOfRevealingLightRestoredReset } from "#lua/snapshot-swords-of-revealing-light.js";
import { isKnownPlayerDamageZeroEffect, isKnownTemporaryActivationLockEffect, isKnownTemporaryArtifactLanceaBanishLockEffect, isKnownTemporaryBattleProtectionEffect, isKnownTemporaryCannotAttackEffect, isKnownTemporaryEarthshatteringDeckGraveLockEffect, isKnownTemporaryOpponentCannotBattlePhaseEffect, isKnownTemporaryOpponentTurnSkipMain1Effect, isKnownTemporaryOpponentTurnSkipMain2Effect, isKnownTemporaryOpponentTurnSkipTurnEffect, isKnownTemporaryPlayerAttackAnnounceLockEffect, isKnownTemporarySameCodeActivationOathEffect, isKnownTemporarySelfTurnCannotEndPhaseEffect, isKnownTemporarySelfTurnSkipBattlePhaseEffect, isKnownTemporarySummonSetLockEffect, temporaryOpponentTurnSkipMain1CanActivate, temporarySelfTurnSkipBattlePhaseCanActivate } from "#lua/snapshot-temporary-effects.js";
import { assaultZoneExtraDeckReleaseValueCallbacks, assaultZoneReleaseFlagConditionCallbacks, assaultZoneReleaseFlagOperation, isAssaultZoneExtraDeckReleaseRestoreEffect } from "#lua/snapshot-assault-zone.js";
import { calledByTheGraveChainSolvingNegateOperation, isKnownCalledByTheGraveChainSolvingNegateEffect, isKnownRareMetalmorphChainSolvingNegateEffect, rareMetalmorphChainSolvingNegateOperation } from "#lua/snapshot-chain-solving-effects.js";
import { ritualSummonSelectedMaterials, type LuaDuelSummonApiHostState } from "#lua/duel-api/summon.js";
import { luaTemporaryControlReturnDescriptor, luaTemporaryControlReturnOperation } from "#lua/duel-api/move-control.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import { specialSummonTypeIsCostDescriptor, specialSummonTypeNotCostDescriptor } from "#lua/effect-cost-descriptor.js";
import { locationMatchesCardMask, positionMaskFromPosition } from "#lua/api-utils.js"; import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { notSetcodeTargetDescriptor, restoredLuaTargetCallbacks, setcodeOrCodeTypeTargetDescriptor, typeTargetDescriptor } from "#lua/snapshot-target-callbacks.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, ChainLimit, ChainLink, DuelAction, DuelCardInstance, DuelCardReader, DuelEffectDefinition, DuelResponse, DuelSession, PlayerId, SerializedDuel, SerializedDuelEffect } from "#duel/types.js";
const luaEffectEquipLimit = 76;
const luaEffectGeminiStatus = 75;
const luaEffectAddType = 115;
const luaEffectRemainField = 17;
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
const luaCannotActivateNonSpiritMonsterDescriptor = "cannot-activate:non-spirit-monster-effect";
const luaSourceControllerConditionDescriptor = "condition:source-controller";
const luaNotDrawPhaseConditionDescriptor = "condition:not-draw-phase";
const luaSourceEquippedConditionDescriptor = "condition:source-equipped";
const luaMaharaghiCode = "40695128";
const luaHinoKaguTsuchiCode = "75745607";
const luaGreatLongNoseCode = "2356994";
const luaMegalithUnformedCode = "69003792";
const luaSetMegalith = 0x138;
const luaCategorySpecialSummon = 0x200;
const luaLocationDeck = 0x1;
const luaTypeMonster = 0x1;
const luaTypeRitual = 0x80;
const luaTypeSpirit = 0x200;
const luaTypeTuner = 0x1000;
const luaResetEvent = 0x1000;
const luaResetChain = 0x80000000;
const luaResetTurnSet = 0x20000;
const luaResetPhase = 0x40000000;
const luaResetOpponentTurn = 0x20000000;
const luaPhaseBattle = 0x80;
const luaPhaseEnd = 0x200;
const luaBattlePhaseEventCode = luaResetEvent | luaPhaseBattle;
const luaPhaseEndEventCode = luaResetEvent | luaPhaseEnd;
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
  restoreKnownLuaChainOperations(session);
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
  if (!snapshotEffect) return effect;
  return {
    ...effect, ...((snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-battle-target") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-status-summon-type:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-relate-battle-target") === true || snapshotEffect.luaConditionDescriptor === "condition:damage-source-relate-battle-target" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-location-reason-all-player:") === true || snapshotEffect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent" || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-side-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason-player:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason-player-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-controller-previous-position-location-reason:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-location:") === true || snapshotEffect.luaConditionDescriptor?.startsWith("condition:source-previous-position-position:") === true) ? restoredLuaConditionCallbacks(snapshotEffect) : {}),
    ...(snapshotEffect.reset === undefined ? {} : { reset: { ...snapshotEffect.reset } }),
    ...(snapshotEffect.labelObjectUid === undefined ? {} : { labelObjectUid: snapshotEffect.labelObjectUid }),
    ...(snapshotEffect.labelObjectUids === undefined ? {} : { labelObjectUids: [...snapshotEffect.labelObjectUids] }),
  };
}

function findRestoredLuaStateSnapshotEffect(
  session: DuelSession,
  effect: DuelEffectDefinition,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: Set<string>,
): SerializedDuelEffect | undefined {
  if (!isKnownLuaUnionStateEffect(session, effect) && !isKnownLuaGeminiStateEffect(effect)) return undefined;
  return snapshotEffects.find((snapshotEffect) => {
    if (!snapshotEffect.registryKey || !registryKeys.has(snapshotEffect.registryKey) || restoredRegistryKeys.has(snapshotEffect.registryKey)) return false;
    return (
      snapshotEffect.sourceUid === effect.sourceUid &&
      snapshotEffect.event === effect.event &&
      snapshotEffect.code === effect.code &&
      (isKnownLuaUnionStateEffect(session, snapshotEffect) || isKnownLuaGeminiStateEffect(snapshotEffect))
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
    if (!isKnownRestorableLuaEffect(effect, snapshotEffects)) continue;
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

function restoredLuaEffectReset(session: DuelSession, effect: SerializedDuelEffect): DuelEffectDefinition["reset"] | undefined {
  if (!effect.reset) return undefined;
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) return swordsOfRevealingLightRestoredReset(session, effect);
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
    (effect.event === "continuous" &&
      (effect.code === 2 ||
        effect.code === 8 ||
        effect.code === 22 ||
        isKnownGeminiStatusEffect(effect) ||
        isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects) ||
        isKnownSpiritAddTypeEffect(effect) ||
        isKnownTemporaryTunerAddTypeEffect(effect) ||
        isKnownGrantedSpiritEndPhaseReturnEffect(effect, snapshotEffects) ||
        isStaticNotSetcodeSummonRestriction(effect) ||
        isKnownSetcodeTypeExtraSummonRestriction(effect) ||
        isKnownSetSummonCountLimitEffect(effect) ||
        isKnownExtraSummonCountEffect(effect) ||
        effect.code === 25 ||
        (effect.code === 60 && effect.value !== undefined) ||
        (effect.code === 92 && (specialSummonTypeNotCostDescriptor(effect.luaCostDescriptor) !== undefined || specialSummonTypeIsCostDescriptor(effect.luaCostDescriptor) !== undefined)) ||
        effect.code === luaEffectClockLizard ||
        isKnownCannotBeMaterialEffect(effect) ||
        (effect.code === 71 && effect.luaValueDescriptor === "cannot-be-effect-target:opponent") ||
        isKnownIndestructibleValueEffect(effect) ||
        effect.luaValueDescriptor === "change-damage:effect-double" || (effect.luaValueDescriptor === "change-damage:effect-zero" && effect.reset !== undefined) ||
        effect.luaValueDescriptor === "reflect-damage:opponent-non-continuous" ||
        isKnownLifePointReasonPredicateEffect(effect) ||
        isKnownIndestructibleCountReasonPredicateEffect(effect) ||
        isKnownCannotSelectBattleTargetNotHandlerEffect(effect) ||
        isKnownYellowAlertDelayedReturnEffect(effect) ||
        isKnownCalledByTheGraveChainSolvingNegateEffect(effect) ||
        isKnownRareMetalmorphChainSolvingNegateEffect(effect) ||
        isKnownBookOfEclipsePhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightPhaseEndEffect(effect) ||
        isKnownSwordsOfRevealingLightResetEffect(effect) ||
        isKnownTemporaryPlayerAttackAnnounceLockEffect(effect) || isKnownTemporaryCannotAttackEffect(effect) || isKnownTemporaryBattleProtectionEffect(effect) || isKnownPlayerDamageZeroEffect(effect) || isKnownTemporarySummonSetLockEffect(effect) || isKnownTemporaryActivationLockEffect(effect) || isKnownTemporarySelfTurnSkipBattlePhaseEffect(effect) || isKnownTemporaryOpponentTurnSkipMain1Effect(effect) || isKnownTemporaryOpponentTurnSkipMain2Effect(effect) || isKnownTemporarySelfTurnCannotEndPhaseEffect(effect) || isKnownTemporarySameCodeActivationOathEffect(effect) || isKnownTemporaryOpponentTurnSkipTurnEffect(effect) || isKnownTemporaryOpponentCannotBattlePhaseEffect(effect) || isKnownTemporaryArtifactLanceaBanishLockEffect(effect) || isKnownTemporaryEarthshatteringDeckGraveLockEffect(effect) ||
        isAssaultZoneExtraDeckReleaseRestoreEffect(effect) ||
        isKnownMaharaghiPredrawEffect(effect) ||
        isKnownHinoKaguTsuchiPredrawDiscardEffect(effect) ||
        isKnownGreatLongNoseSkipBattlePhaseEffect(effect) ||
        isKnownUnleashYourPowerDelayedSetEffect(effect) ||
        isKnownRemainFieldEffect(effect) ||
        isKnownCannotActivateSpecialSummonedMonsterEffect(effect) ||
        isKnownCannotActivateNonSpiritMonsterEffect(effect) ||
        isKnownSetcodeOrCodeTypeBattleProtectionEffect(effect) ||
        effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor ||
        isStaticSingleCardLuaRestriction(effect) ||
        isStaticPlayerPhaseLock(effect) ||
        (effect.code === 102 && effect.value !== undefined && effect.value !== 0 && effect.targetRange === undefined) ||
        ((effect.code === 100 || effect.code === 103 || effect.code === 104 || effect.code === 107 || effect.code === 130 || effect.code === 131 || effect.code === 132 || effect.code === 314) && effect.value !== undefined)))
  );
}

function isKnownCannotBeMaterialEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && [235, 236, 238, 239, 248].includes(effect.code ?? -1) && (effect.luaValueDescriptor?.startsWith("cannot-material:") === true || effect.value !== undefined); }

function isKnownGeminiStatusEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectGeminiStatus &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

function isKnownRemainFieldEffect(effect: SerializedDuelEffect): boolean {
  return effect.code === luaEffectRemainField && effect.sourceUid !== undefined && effect.reset?.flags === luaResetChain && effect.targetRange === undefined && effect.range.includes("spellTrapZone");
}

function isKnownGeminiEndPhaseReturnEffect(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaResetsStandardPhaseEnd &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    snapshotEffects.some((candidate) => candidate.sourceUid === effect.sourceUid && isKnownGeminiStatusEffect(candidate))
  );
}

function isKnownSpiritAddTypeEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectAddType &&
    effect.value === luaTypeSpirit &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

function isKnownTemporaryTunerAddTypeEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectAddType &&
    effect.value === luaTypeTuner &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

function isKnownGrantedSpiritEndPhaseReturnEffect(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    snapshotEffects.some((candidate) => candidate.sourceUid === effect.sourceUid && isKnownSpiritAddTypeEffect(candidate))
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

function isKnownCannotActivateNonSpiritMonsterEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.luaValueDescriptor === luaCannotActivateNonSpiritMonsterDescriptor &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 1 &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

function isKnownSetcodeOrCodeTypeBattleProtectionEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === 201 || effect.code === luaEffectIndestructibleBattle) &&
    effect.value === 1 &&
    setcodeOrCodeTypeTargetDescriptor(effect.luaTargetDescriptor) !== undefined &&
    isPhaseEndOrOpponentPhaseEndReset(effect.reset?.flags) &&
    effect.targetRange?.[0] === 4 &&
    effect.targetRange?.[1] === 0 &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isPhaseEndOrOpponentPhaseEndReset(flags: number | undefined): boolean {
  return flags === luaPhaseEndResetFlags || flags === (luaPhaseEndResetFlags | luaResetOpponentTurn);
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

function isKnownExtraSummonCountEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 29 && effect.targetRange !== undefined && (effect.luaTargetDescriptor === undefined || typeTargetDescriptor(effect.luaTargetDescriptor) !== undefined); }

function isKnownSetSummonCountLimitEffect(effect: SerializedDuelEffect): boolean { return effect.event === "continuous" && effect.code === 28 && effect.value !== undefined && effect.targetRange !== undefined && effect.reset !== undefined; }

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

function restoredLuaOperation(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[] = []): DuelEffectDefinition["operation"] {
  if (isKnownYellowAlertDelayedReturnEffect(effect)) return yellowAlertDelayedReturnOperation(effect);
  if (isKnownCalledByTheGraveChainSolvingNegateEffect(effect)) return calledByTheGraveChainSolvingNegateOperation(effect);
  if (isKnownRareMetalmorphChainSolvingNegateEffect(effect)) return rareMetalmorphChainSolvingNegateOperation(effect);
  if (isKnownBookOfEclipsePhaseEndEffect(effect)) return bookOfEclipsePhaseEndOperation(effect);
  if (isKnownSwordsOfRevealingLightPhaseEndEffect(effect)) return swordsOfRevealingLightPhaseEndOperation();
  if (isKnownMaharaghiPredrawEffect(effect)) return maharaghiPredrawOperation(effect);
  if (isKnownHinoKaguTsuchiPredrawDiscardEffect(effect)) return hinoKaguTsuchiPredrawDiscardOperation(effect);
  const assaultZoneOperation = assaultZoneReleaseFlagOperation(effect);
  if (assaultZoneOperation) return assaultZoneOperation;
  if (isKnownGeminiEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownGrantedSpiritEndPhaseReturnEffect(effect, snapshotEffects)) return luaHandlerReturnToHandOperation(effect);
  if (isKnownUnleashYourPowerDelayedSetEffect(effect)) return unleashYourPowerDelayedSetOperation(effect);
  if (effect.luaValueDescriptor === luaTemporaryControlReturnDescriptor) {
    const returnPlayer = effect.value === 0 || effect.value === 1 ? effect.value : undefined;
    return luaTemporaryControlReturnOperation(returnPlayer);
  }
  return () => {};
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
  const assaultZoneValueCallbacks = assaultZoneExtraDeckReleaseValueCallbacks(effect);
  if (assaultZoneValueCallbacks.valuePredicate) return assaultZoneValueCallbacks;
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
  if (effect.luaValueDescriptor === luaCannotActivateNonSpiritMonsterDescriptor) return { valuePredicate: (ctx) => relatedEffectIsNonSpiritMonsterEffect(ctx) };
  if (effect.luaValueDescriptor === "cannot-activate:card-activation") return { valuePredicate: (ctx) => ((relatedEffectFromContext(ctx)?.luaTypeFlags ?? 0) & 0x10) !== 0 };
  if (effect.luaValueDescriptor === "cannot-activate:spell-card-activation" || effect.luaValueDescriptor === "cannot-activate:trap-card-activation") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const type = effect.luaValueDescriptor === "cannot-activate:spell-card-activation" ? 0x2 : 0x4; return Boolean(handler && ((relatedEffect?.luaTypeFlags ?? 0) & 0x10) !== 0 && (cardTypeFlags(handler, ctx.duel) & type) !== 0); } };
  if (effect.luaValueDescriptor === "cannot-activate:same-code") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaValueDescriptor === "cannot-activate:same-code-monster-effect") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } }; if (isKnownTemporarySameCodeActivationOathEffect(effect)) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const source = ctx.duel.cards.find((card) => card.uid === effect.sourceUid); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(source && handler && ((relatedEffect?.luaTypeFlags ?? 0) & 0x10) !== 0 && currentCardMatchesCode(handler, ctx.duel, source.code)); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:setcode-monster-effect:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const setcode = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && currentCardMatchesSetcode(handler, ctx.duel, setcode)); } };
  if (effect.luaValueDescriptor === "cannot-activate:spell-trap-effect") return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & 0x6) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-activate:monster-attribute-except:")) return { valuePredicate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); const attribute = Number(effect.luaValueDescriptor?.split(":").pop()); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && ((handler.data.attribute ?? 0) & ~attribute) !== 0); } };
  if (effect.luaValueDescriptor?.startsWith("cannot-material:summon-types:")) {
    const summonTypes = effect.luaValueDescriptor.slice("cannot-material:summon-types:".length).split(",").map(Number);
    return { valuePredicate: (ctx) => summonTypes.includes(ctx.summonTypeCode ?? 0) };
  }
  if (effect.luaValueDescriptor?.startsWith("cannot-material:controller-summon-types:")) { const summonTypes = effect.luaValueDescriptor.slice("cannot-material:controller-summon-types:".length).split(",").map(Number); return { valuePredicate: (ctx) => summonTypes.includes(ctx.summonTypeCode ?? 0) && ctx.eventCard?.controller === effect.controller }; }
  if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-setcode:")) return { valuePredicate: (ctx) => !ctx.eventCard || !currentCardMatchesSetcode(ctx.eventCard, ctx.duel, Number(effect.luaValueDescriptor?.split(":").pop())) }; if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-race:")) return { valuePredicate: (ctx) => !ctx.eventCard || (currentRace(ctx.eventCard, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) === 0 }; if (effect.luaValueDescriptor?.startsWith("cannot-material:target-not-attribute:")) return { valuePredicate: (ctx) => !ctx.eventCard || (currentAttribute(ctx.eventCard, ctx.duel) & Number(effect.luaValueDescriptor?.split(":").pop())) === 0 };
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
  const skipBattleCondition = temporarySelfTurnSkipBattlePhaseCanActivate(effect); if (skipBattleCondition) return { canActivate: skipBattleCondition };
  const skipMain1Condition = temporaryOpponentTurnSkipMain1CanActivate(effect); if (skipMain1Condition) return { canActivate: skipMain1Condition };
  const assaultZoneConditionCallbacks = assaultZoneReleaseFlagConditionCallbacks(effect);
  if (assaultZoneConditionCallbacks.canActivate) return assaultZoneConditionCallbacks;
  if (effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor) return { canActivate: (ctx) => ctx.source.controller === effect.controller };
  if (effect.luaConditionDescriptor === luaNotDrawPhaseConditionDescriptor) return { canActivate: (ctx) => ctx.duel.phase !== "draw" };
  if (effect.luaConditionDescriptor === luaSourceEquippedConditionDescriptor) return { canActivate: (ctx) => ctx.source.equippedToUid !== undefined };
  if (effect.luaConditionDescriptor === "condition:chain-solving-monster-effect-handler-original-code-label") return { canActivate: (ctx) => { const relatedEffect = relatedEffectFromContext(ctx); const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid); return Boolean(handler && (cardTypeFlags(handler, ctx.duel) & luaTypeMonster) !== 0 && effect.label !== undefined && currentCardMatchesCode(handler, ctx.duel, String(effect.label))); } };
  if (effect.luaConditionDescriptor?.startsWith("condition:custom-activity-chain-count-at-least:")) return { canActivate: (ctx) => ctx.duel.activityHistory.filter((record) => record.player === effect.controller && record.activity === 0x20).length >= Number(effect.luaConditionDescriptor?.split(":").pop()) };
  if (effect.luaConditionDescriptor === "condition:source-faceup") return { canActivate: (ctx) => ctx.source.faceUp === true };
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
function luaChainLimitRegistryKeys(snapshot: SerializedDuel): string[] { return snapshot.state.chainLimits.map((limit) => limit.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua-chain-limit:"))); }
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
  if (knownPredicate?.startsWith("closure:card-not-handler-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:cards-not-handler-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:target-cards-not-handler-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:target-cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:original-type-mask-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:type-mask-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-unless-chain-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type-setcode:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type-effect-type:") || knownPredicate?.startsWith("closure:counter-activate-or-handler-code:") || knownPredicate === "closure:not-opponent-controlled-trap") return (limit) => ({ ...limit, allows: () => false });
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
function luaRestoreIncompleteError(restored: LuaSnapshotRestoreResult): string { return restored.incompleteReasons.length === 0 ? "Lua snapshot restore is incomplete" : `Lua snapshot restore is incomplete: ${restored.incompleteReasons.join("; ")}`; }
function luaRegistryCardCodes(registryKeys: Set<string>, chainLimitRegistryKeys: string[] = []): Set<string> {
  const codes = new Set<string>();
  for (const key of [...registryKeys, ...chainLimitRegistryKeys]) { const [, code] = key.split(":"); if (code && /^\d+$/.test(code)) codes.add(code); }
  return codes;
}
