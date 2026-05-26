import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setMegalith = 0x138;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const luaSummonTypeRitual = 0x45000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Megalith Ophiel ritual summon search", () => {
  it("restores its delayed ritual Special Summon trigger into a Megalith monster search and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ophielCode = "63056220";
    const searchTargetCode = "63056221";
    const decoyCode = "63056222";
    const responderCode = "63056223";
    const script = workspace.readScript(`c${ophielCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsRitualSummoned() end)");
    expect(script).toContain("return c:IsSetCard(SET_MEGALITH) and c:IsMonster() and not c:IsCode(id) and c:IsAbleToHand()");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ophielCode),
      {
        code: searchTargetCode,
        name: "Megalith Ophiel Search Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeRitual,
        level: 4,
        attack: 1600,
        defense: 1200,
        setcodes: [setMegalith],
      },
      { code: decoyCode, name: "Megalith Ophiel Non-Megalith Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Megalith Ophiel Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 63056220, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ophielCode, searchTargetCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ophiel = requireCard(session.state.cards, ophielCode);
    const searchTarget = requireCard(session.state.cards, searchTargetCode);
    const decoy = requireCard(session.state.cards, decoyCode);
    const responder = requireCard(session.state.cards, responderCode);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 3;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ophielCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const previousOphielState = cardEventState(ophiel);
    specialSummonDuelCard(session.state, ophiel.uid, 0, 0, {}, luaSummonTypeRitual);
    const currentOphielState = { ...previousOphielState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const pendingSearch = restoredTriggerWindow.session.state.pendingTriggers[0];
    expect(pendingSearch).toBeDefined();
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: pendingSearch!.effectId,
        sourceUid: ophiel.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: ophiel.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousOphielState,
        eventCurrentState: currentOphielState,
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === ophiel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: pendingSearch!.effectId,
        sourceUid: ophiel.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: ophiel.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousOphielState,
        eventCurrentState: currentOphielState,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
      },
    ]);

    const targetPreviousState = cardEventState(searchTarget);
    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchChain, pass!);

    expect(restoredSearchChain.session.state.chain).toEqual([]);
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === ophiel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
    });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${searchTargetCode}`]);
    expect(restoredSearchChain.host.messages).not.toContain("megalith ophiel responder resolved");
    expect(
      restoredSearchChain.session.state.eventHistory.filter((event) =>
        ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
      ),
    ).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ophiel.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: previousOphielState,
        eventCurrentState: currentOphielState,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ophiel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: targetPreviousState,
        eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ophiel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: targetPreviousState,
        eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ophiel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: targetPreviousState,
        eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
      e:SetOperation(function(e,tp) Debug.Message("megalith ophiel responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
