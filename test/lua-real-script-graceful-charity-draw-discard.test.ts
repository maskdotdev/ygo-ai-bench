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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Graceful Charity draw discard", () => {
  it("restores Graceful Charity's draw-three, hand shuffle, and discard-two resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gracefulCode = "79571449";
    const handACode = "79571450";
    const handBCode = "79571451";
    const drawACode = "79571452";
    const drawBCode = "79571453";
    const drawCCode = "79571454";
    const responderCode = "79571455";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gracefulCode),
      { code: handACode, name: "Graceful Charity Initial Hand A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: handBCode, name: "Graceful Charity Initial Hand B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawACode, name: "Graceful Charity Draw A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawBCode, name: "Graceful Charity Draw B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawCCode, name: "Graceful Charity Draw C", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Graceful Charity Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 795, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gracefulCode, handACode, handBCode, drawACode, drawBCode, drawCCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const graceful = session.state.cards.find((card) => card.code === gracefulCode);
    const handA = session.state.cards.find((card) => card.code === handACode);
    const handB = session.state.cards.find((card) => card.code === handBCode);
    const drawA = session.state.cards.find((card) => card.code === drawACode);
    const drawB = session.state.cards.find((card) => card.code === drawBCode);
    const drawC = session.state.cards.find((card) => card.code === drawCCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(graceful).toBeDefined();
    expect(handA).toBeDefined();
    expect(handB).toBeDefined();
    expect(drawA).toBeDefined();
    expect(drawB).toBeDefined();
    expect(drawC).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, graceful!.uid, "hand", 0);
    moveDuelCard(session.state, handA!.uid, "hand", 0);
    moveDuelCard(session.state, handB!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(gracefulCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const gracefulAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === graceful!.uid);
    expect(gracefulAction).toBeDefined();
    applyAndAssert(session, gracefulAction!);
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
            "category": 65536,
            "count": 0,
            "parameter": 3,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 128,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-79571449-0",
        "targetParam": 3,
        "targetPlayer": 0,
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 3 },
      { category: 0x80, targetUids: [], count: 0, player: 0, parameter: 2 },
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
            "category": 65536,
            "count": 0,
            "parameter": 3,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 128,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-79571449-0",
        "targetParam": 3,
        "targetPlayer": 0,
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 3 },
      { category: 0x80, targetUids: [], count: 0, player: 0, parameter: 2 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === graceful!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.filter((card) => [handA!.uid, handB!.uid, drawA!.uid, drawB!.uid, drawC!.uid].includes(card.uid) && card.location === "graveyard")).toHaveLength(2);
    expect(restored.session.state.cards.filter((card) => [handA!.uid, handB!.uid, drawA!.uid, drawB!.uid, drawC!.uid].includes(card.uid) && card.location === "hand")).toHaveLength(3);
    expect(restored.session.state.eventHistory.filter((event) => ["cardsDrawn", "discarded"].includes(event.eventName))).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 3,
        eventUids: [drawA!.uid, drawC!.uid, drawB!.uid],
        eventCardUid: drawA!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graceful!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 2, position: "faceDown", faceUp: false },
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: drawA!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: graceful!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: drawB!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: graceful!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: drawA!.uid,
        eventUids: [drawA!.uid, drawB!.uid],
        eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: graceful!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("graceful charity responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("graceful charity responder resolved") end)
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
