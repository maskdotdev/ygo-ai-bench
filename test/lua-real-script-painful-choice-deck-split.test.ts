import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Painful Choice Deck split", () => {
  it("restores Painful Choice's five-card Deck reveal, opponent choice, and graveyard split", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const painfulChoiceCode = "74191942";
    const choiceACode = "74191943";
    const choiceBCode = "74191944";
    const choiceCCode = "74191945";
    const choiceDCode = "74191946";
    const choiceECode = "74191947";
    const responderCode = "74191948";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === painfulChoiceCode),
      { code: choiceACode, name: "Painful Choice A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: choiceBCode, name: "Painful Choice B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: choiceCCode, name: "Painful Choice C", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: choiceDCode, name: "Painful Choice D", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: choiceECode, name: "Painful Choice E", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Painful Choice Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 741, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [painfulChoiceCode, choiceACode, choiceBCode, choiceCCode, choiceDCode, choiceECode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const painfulChoice = session.state.cards.find((card) => card.code === painfulChoiceCode);
    const choiceA = session.state.cards.find((card) => card.code === choiceACode);
    const choiceB = session.state.cards.find((card) => card.code === choiceBCode);
    const choiceC = session.state.cards.find((card) => card.code === choiceCCode);
    const choiceD = session.state.cards.find((card) => card.code === choiceDCode);
    const choiceE = session.state.cards.find((card) => card.code === choiceECode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(painfulChoice).toBeDefined();
    expect(choiceA).toBeDefined();
    expect(choiceB).toBeDefined();
    expect(choiceC).toBeDefined();
    expect(choiceD).toBeDefined();
    expect(choiceE).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, painfulChoice!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(painfulChoiceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === painfulChoice!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 32,
            "count": 4,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-74191942-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 },
      { category: 0x20, targetUids: [], count: 4, player: 0, parameter: 1 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 32,
            "count": 4,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-74191942-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 },
      { category: 0x20, targetUids: [], count: 4, player: 0, parameter: 1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === painfulChoice!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === choiceC!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.filter((card) => [choiceA!.uid, choiceB!.uid, choiceD!.uid, choiceE!.uid].includes(card.uid) && card.location === "graveyard")).toHaveLength(4);
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "sentToHand", "sentToGraveyard"].includes(event.eventName) && event.eventCardUid !== painfulChoice!.uid)).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [choiceC!.uid, choiceE!.uid, choiceA!.uid, choiceD!.uid, choiceB!.uid],
        eventValue: 5,
        eventCardUid: choiceC!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: choiceC!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: choiceE!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: choiceA!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 2, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: choiceD!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 3, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 2, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: choiceB!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 5, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 3, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventUids: [choiceE!.uid, choiceA!.uid, choiceD!.uid, choiceB!.uid],
        eventCardUid: choiceE!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: painfulChoice!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).toEqual([`confirmed 1: ${choiceCCode},${choiceECode},${choiceACode},${choiceDCode},${choiceBCode}`]);
    expect(restored.host.messages).not.toContain("painful choice responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("painful choice responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
