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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Avarice five Graveyard shuffle draw", () => {
  it("restores Pot of Avarice's five Graveyard targets, Deck shuffle, and draw-two operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "67169062";
    const graveCodes = ["67169063", "67169064", "67169065", "67169066", "67169067"];
    const drawCodes = ["67169068", "67169069"];
    const responderCode = "67169070";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      ...graveCodes.map((code, index) => ({ code, name: `Pot of Avarice Graveyard Monster ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      ...drawCodes.map((code, index) => ({ code, name: `Pot of Avarice Draw ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      { code: responderCode, name: "Pot of Avarice Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 671, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, ...graveCodes, ...drawCodes] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const graveCards = graveCodes.map((code) => session.state.cards.find((card) => card.code === code));
    const drawCards = drawCodes.map((code) => session.state.cards.find((card) => card.code === code));
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(graveCards.every(Boolean)).toBe(true);
    expect(drawCards.every(Boolean)).toBe(true);
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
    for (const card of graveCards) moveDuelCard(session.state, card!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(potCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const potAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pot!.uid);
    expect(potAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, potAction!);
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
            "category": 16,
            "count": 5,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-67169063-1",
              "p0-deck-67169064-2",
              "p0-deck-67169065-3",
              "p0-deck-67169066-4",
              "p0-deck-67169067-5",
            ],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-67169062-0",
        "targetFieldIds": [
          11,
          12,
          13,
          14,
          15,
        ],
        "targetUids": [
          "p0-deck-67169063-1",
          "p0-deck-67169064-2",
          "p0-deck-67169065-3",
          "p0-deck-67169066-4",
          "p0-deck-67169067-5",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: graveCards.map((card) => card!.uid), count: 5, player: 0, parameter: 0 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 },
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
            "category": 16,
            "count": 5,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-67169063-1",
              "p0-deck-67169064-2",
              "p0-deck-67169065-3",
              "p0-deck-67169066-4",
              "p0-deck-67169067-5",
            ],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-67169062-0",
        "targetFieldIds": [
          11,
          12,
          13,
          14,
          15,
        ],
        "targetUids": [
          "p0-deck-67169063-1",
          "p0-deck-67169064-2",
          "p0-deck-67169065-3",
          "p0-deck-67169066-4",
          "p0-deck-67169067-5",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: graveCards.map((card) => card!.uid), count: 5, player: 0, parameter: 0 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === pot!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[0]!.uid)).toMatchObject({ location: "hand", controller: 0, sequence: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[1]!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 5 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[2]!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 2 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[3]!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 4 });
    expect(restored.session.state.cards.find((card) => card.uid === graveCards[4]!.uid)).toMatchObject({ location: "hand", controller: 0, sequence: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === drawCards[0]!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 6 });
    expect(restored.session.state.cards.find((card) => card.uid === drawCards[1]!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 3 });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[1]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 3, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[2]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 2, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 4, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[3]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 3, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 5, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[4]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 4, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 6, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 4, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventUids: graveCards.map((card) => card!.uid),
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [graveCards[4]!.uid, graveCards[0]!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventCardUid: graveCards[4]!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("pot avarice responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("pot avarice responder resolved") end)
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
