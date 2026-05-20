import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const soldierCode = "46659709";
const costCode = "466597090";
const searchCode = "466597091";
const decoyCode = "466597092";
const responderCode = "466597093";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceMachine = 0x20;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setGalaxy = 0x7b;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Galaxy Soldier discard summon search", () => {
  it("restores LIGHT discard cost, defense Special Summon, and delayed Galaxy monster search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${soldierCode}.lua`);
    expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST,e:GetHandler())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsSetCard(SET_GALAXY) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === soldierCode),
      { code: costCode, name: "Galaxy Soldier LIGHT Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
      { code: searchCode, name: "Galaxy Soldier Search Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1600, defense: 1600, setcodes: [setGalaxy] },
      { code: decoyCode, name: "Galaxy Soldier Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setGalaxy] },
      { code: responderCode, name: "Galaxy Soldier Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46659709, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soldierCode, costCode, searchCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const soldier = requireCard(session, soldierCode);
    const cost = requireCard(session, costCode);
    const search = requireCard(session, searchCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, soldier.uid, "hand", 0);
    moveDuelCard(session.state, cost.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soldierCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const special = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === soldier.uid);
    expect(special, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, special!);
    expect(session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: soldier.uid,
      reasonEffectId: 1,
    });
    expect(session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: soldier.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, targetUids: [soldier.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    expect(getLuaRestoreLegalActions(restoredSummonChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredSummonChain);
    expect(restoredSummonChain.host.messages).not.toContain("galaxy soldier responder resolved");
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === soldier.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: soldier.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonChain.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-2-1102",
        sourceUid: soldier.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: soldier.uid,
        eventUids: [soldier.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: soldier.uid,
        eventUids: [soldier.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === soldier.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        sourceUid: soldier.uid,
        player: 0,
        effectId: "lua-2-1102",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: soldier.uid,
        eventUids: [soldier.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: soldier.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName) && event.eventCardUid === search.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("galaxy soldier responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
