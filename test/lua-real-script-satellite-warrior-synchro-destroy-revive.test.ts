import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const satelliteCode = "84664085";
const tunerCode = "846640850";
const synchroMaterialCode = "846640851";
const graveSynchroCode = "846640852";
const targetMonsterCode = "846640853";
const targetSpellCode = "846640854";
const reviveWarriorCode = "846640855";
const reviveSynchronCode = "846640856";
const reviveStardustCode = "846640857";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSatelliteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${satelliteCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const setWarrior = 0x2066;
const setSynchron = 0x1017;
const setStardust = 0xa3;

describe.skipIf(!hasUpstreamScripts || !hasSatelliteScript)("Lua real script Satellite Warrior Synchro destroy revive", () => {
  it("restores Synchro non-Tuner procedure, summon-success target destroy ATK gain, and destroyed self revive group", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${satelliteCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsType,TYPE_SYNCHRO),1,99)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsSynchroSummoned() end)");
    expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsType,tp,LOCATION_GRAVE,0,nil,TYPE_SYNCHRO)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_ONFIELD,1,ct,nil)");
    expect(script).toContain("local tg=Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.Destroy(tg,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(ct*1000)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("return c:IsPreviousLocation(LOCATION_MZONE) and c:IsSynchroSummoned()");
    expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ft,aux.dncheck,1,tp,HINTMSG_SPSUMMON)");
    expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");

    const reader = createCardReader(cards());
    const summonSession = createDuel({ seed: 84664085, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [tunerCode, synchroMaterialCode, graveSynchroCode], extra: [satelliteCode] }, 1: { main: [targetMonsterCode, targetSpellCode] } });
    startDuel(summonSession);
    const satellite = requireCard(summonSession, satelliteCode);
    const tuner = requireCard(summonSession, tunerCode);
    const synchroMaterial = requireCard(summonSession, synchroMaterialCode);
    const graveSynchro = requireCard(summonSession, graveSynchroCode);
    const targetMonster = requireCard(summonSession, targetMonsterCode, 1);
    const targetSpell = requireCard(summonSession, targetSpellCode, 1);
    moveFaceUpAttack(summonSession, tuner, 0);
    moveFaceUpAttack(summonSession, synchroMaterial, 0);
    moveDuelCard(summonSession.state, graveSynchro.uid, "graveyard", 0);
    moveFaceUpAttack(summonSession, targetMonster, 1);
    moveFaceUpSpell(summonSession, targetSpell, 1);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(satelliteCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);
    expect(satellite.data.synchroTunerMin).toBe(1);
    expect(satellite.data.synchroNonTunerMin).toBe(1);
    expect(satellite.data.synchroNonTunerMax).toBe(99);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchro = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === satellite.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(synchroMaterial.uid)
    );
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchro!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === satellite.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, synchroMaterial.uid],
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
    });
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === satellite.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    for (const target of [targetMonster, targetSpell]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: satellite.uid,
        reasonEffectId: 3,
      });
    }
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === satellite.uid), restoredTrigger.session.state)).toBe(4500);
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      event.eventName === "chainSolved" || (["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName) && [targetMonster.uid, targetSpell.uid].includes(event.eventCardUid ?? ""))
    )).toEqual([
      becameTargetEvent(targetMonster, satellite.uid, 3, "chain-7", { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 }),
      becameTargetEvent(targetSpell, satellite.uid, 3, "chain-7", { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 }),
      destroyedEvent(targetMonster, satellite.uid, 3, { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }),
      sentToGraveyardEvent(targetMonster, satellite.uid, 3, { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }),
      destroyedEvent(targetSpell, satellite.uid, 3, { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 }, { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 }),
      sentToGraveyardEvent(targetSpell, satellite.uid, 3, { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 }, { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 }),
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetMonster.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: satellite.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventUids: [targetMonster.uid, targetSpell.uid],
      },
      { eventName: "chainSolved", eventCode: 1022, eventValue: 1, eventReasonPlayer: 0, eventPlayer: 0, eventChainDepth: 1, eventChainLinkId: "chain-7", relatedEffectId: 3 },
    ]);

    const reviveSession = createDuel({ seed: 84664086, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(reviveSession, { 0: { main: [reviveWarriorCode, reviveSynchronCode, reviveStardustCode], extra: [satelliteCode] }, 1: { main: [] } });
    startDuel(reviveSession);
    const destroyedSatellite = requireCard(reviveSession, satelliteCode);
    const warrior = requireCard(reviveSession, reviveWarriorCode);
    const synchron = requireCard(reviveSession, reviveSynchronCode);
    const stardust = requireCard(reviveSession, reviveStardustCode);
    moveFaceUpAttack(reviveSession, destroyedSatellite, 0);
    destroyedSatellite.summonType = "synchro";
    moveDuelCard(reviveSession.state, warrior.uid, "graveyard", 0);
    moveDuelCard(reviveSession.state, synchron.uid, "graveyard", 0);
    moveDuelCard(reviveSession.state, stardust.uid, "graveyard", 0);
    reviveSession.state.phase = "main1";
    reviveSession.state.turnPlayer = 0;
    reviveSession.state.waitingFor = 0;
    const reviveHost = createLuaScriptHost(reviveSession, workspace);
    expect(reviveHost.loadCardScript(Number(satelliteCode), workspace).ok).toBe(true);
    expect(reviveHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(reviveSession.state, destroyedSatellite.uid, 0, duelReason.effect | duelReason.destroy, 0);

    const restoredReviveTrigger = restoreDuelWithLuaScripts(serializeDuel(reviveSession), workspace, reader);
    expectCleanRestore(restoredReviveTrigger);
    expectRestoredLegalActions(restoredReviveTrigger, 0);
    const reviveTrigger = getLuaRestoreLegalActions(restoredReviveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedSatellite.uid);
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredReviveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReviveTrigger, reviveTrigger!);

    expect(restoredReviveTrigger.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedSatellite.uid,
      reasonEffectId: 4,
    });
    expect(restoredReviveTrigger.session.state.cards.find((card) => card.uid === synchron.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredReviveTrigger.session.state.cards.find((card) => card.uid === stardust.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredReviveTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedSatellite.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard", eventUids: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyedSatellite.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard", eventUids: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: warrior.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedSatellite.uid, eventReasonEffectId: 4, previousLocation: "graveyard", currentLocation: "monsterZone", eventUids: [warrior.uid] },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: satelliteCode, name: "Satellite Warrior", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, level: 10, attack: 2500, defense: 2000 },
    { code: tunerCode, name: "Satellite Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, level: 2, attack: 500, defense: 500 },
    { code: synchroMaterialCode, name: "Satellite Synchro Material", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, level: 8, attack: 2000, defense: 1500 },
    { code: graveSynchroCode, name: "Satellite Grave Synchro", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, level: 7, attack: 2000, defense: 1500 },
    { code: targetMonsterCode, name: "Satellite Opponent Monster", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
    { code: targetSpellCode, name: "Satellite Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: reviveWarriorCode, name: "Satellite Warrior Revive", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, level: 8, attack: 2200, defense: 1800, setcodes: [setWarrior] },
    { code: reviveSynchronCode, name: "Satellite Synchron Revive", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, level: 7, attack: 2100, defense: 1700, setcodes: [setSynchron] },
    { code: reviveStardustCode, name: "Satellite Stardust Revive", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, level: 6, attack: 2000, defense: 1600, setcodes: [setStardust] },
  ];
}

function requireCard(session: DuelSession, code: string, owner?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (owner === undefined || candidate.owner === owner));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function becameTargetEvent(card: DuelCardInstance, sourceUid: string, effectId: number, chainId: string, previous?: object) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: card.uid,
    eventReason: 0,
    eventReasonPlayer: 0,
    eventPreviousState: previous ?? { controller: card.controller, faceUp: card.faceUp, location: card.location, position: card.position, sequence: card.sequence },
    eventCurrentState: { controller: card.controller, faceUp: card.faceUp, location: card.location, position: card.position, sequence: card.sequence },
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainId,
  };
}

function destroyedEvent(card: DuelCardInstance, sourceUid: string, effectId: number, previous: object, current: object) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: card.uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: previous,
    eventCurrentState: current,
  };
}

function sentToGraveyardEvent(card: DuelCardInstance, sourceUid: string, effectId: number, previous: object, current: object) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: card.uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: previous,
    eventCurrentState: current,
  };
}

function specialSummonedEvent(card: DuelCardInstance, sourceUid: string, effectId: number, sequence: number) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: card.uid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "graveyard", position: "faceDown", sequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
