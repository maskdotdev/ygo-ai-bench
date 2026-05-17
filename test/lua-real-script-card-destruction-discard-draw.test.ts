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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Card Destruction discard draw", () => {
  it("restores Card Destruction's all-hand discard, break effect, and both-player draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cardDestructionCode = "72892473";
    const ownDiscardCode = "72892474";
    const ownDrawCode = "72892475";
    const opponentDiscardACode = "72892476";
    const opponentDiscardBCode = "72892477";
    const opponentDrawACode = "72892478";
    const opponentDrawBCode = "72892479";
    const opponentDrawCCode = "72892480";
    const responderCode = "72892481";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cardDestructionCode),
      { code: ownDiscardCode, name: "Card Destruction Own Discard", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ownDrawCode, name: "Card Destruction Own Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDiscardACode, name: "Card Destruction Opponent Discard A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDiscardBCode, name: "Card Destruction Opponent Discard B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDrawACode, name: "Card Destruction Opponent Draw A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDrawBCode, name: "Card Destruction Opponent Draw B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDrawCCode, name: "Card Destruction Opponent Draw C", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Card Destruction Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 728, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [cardDestructionCode, ownDiscardCode, ownDrawCode] },
      1: { main: [opponentDiscardACode, opponentDiscardBCode, responderCode, opponentDrawACode, opponentDrawBCode, opponentDrawCCode] },
    });
    startDuel(session);

    const cardDestruction = session.state.cards.find((card) => card.code === cardDestructionCode);
    const ownDiscard = session.state.cards.find((card) => card.code === ownDiscardCode);
    const ownDraw = session.state.cards.find((card) => card.code === ownDrawCode);
    const opponentDiscardA = session.state.cards.find((card) => card.code === opponentDiscardACode);
    const opponentDiscardB = session.state.cards.find((card) => card.code === opponentDiscardBCode);
    const opponentDrawA = session.state.cards.find((card) => card.code === opponentDrawACode);
    const opponentDrawB = session.state.cards.find((card) => card.code === opponentDrawBCode);
    const opponentDrawC = session.state.cards.find((card) => card.code === opponentDrawCCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(cardDestruction).toBeDefined();
    expect(ownDiscard).toBeDefined();
    expect(ownDraw).toBeDefined();
    expect(opponentDiscardA).toBeDefined();
    expect(opponentDiscardB).toBeDefined();
    expect(opponentDrawA).toBeDefined();
    expect(opponentDrawB).toBeDefined();
    expect(opponentDrawC).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, cardDestruction!.uid, "hand", 0);
    moveDuelCard(session.state, ownDiscard!.uid, "hand", 0);
    moveDuelCard(session.state, opponentDiscardA!.uid, "hand", 1);
    moveDuelCard(session.state, opponentDiscardB!.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(cardDestructionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const cardDestructionAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === cardDestruction!.uid);
    expect(cardDestructionAction).toBeDefined();
    applyAndAssert(session, cardDestructionAction!);
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
            "category": 128,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-72892473-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x80, targetUids: [], count: 0, player: 0, parameter: 1 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
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
            "category": 128,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-72892473-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x80, targetUids: [], count: 0, player: 0, parameter: 1 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === cardDestruction!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownDiscard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDiscardA!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDiscardB!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === responder!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDrawA!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDrawB!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDrawC!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => ["discarded", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: ownDiscard!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: opponentDiscardA!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: opponentDiscardB!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: responder!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 2, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 2, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [ownDraw!.uid],
        eventCardUid: ownDraw!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 1,
        eventValue: 3,
        eventUids: [opponentDrawB!.uid, opponentDrawA!.uid, opponentDrawC!.uid],
        eventCardUid: opponentDrawB!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("card destruction responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("card destruction responder resolved") end)
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
