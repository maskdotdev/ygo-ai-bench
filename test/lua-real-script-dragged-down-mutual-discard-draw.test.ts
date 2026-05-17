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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dragged Down mutual discard draw", () => {
  it("restores Dragged Down into the Grave's mutual hand confirmation, discard, and draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const draggedCode = "16435215";
    const ownHandCode = "16435216";
    const ownDrawCode = "16435217";
    const opponentHandCode = "16435218";
    const opponentDrawCode = "16435219";
    const responderCode = "16435220";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === draggedCode),
      { code: ownHandCode, name: "Dragged Down Own Hand", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ownDrawCode, name: "Dragged Down Own Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentHandCode, name: "Dragged Down Opponent Hand", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDrawCode, name: "Dragged Down Opponent Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Dragged Down Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 164, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [draggedCode, ownHandCode, ownDrawCode] },
      1: { main: [opponentHandCode, responderCode, opponentDrawCode] },
    });
    startDuel(session);

    const dragged = session.state.cards.find((card) => card.code === draggedCode);
    const ownHand = session.state.cards.find((card) => card.code === ownHandCode);
    const ownDraw = session.state.cards.find((card) => card.code === ownDrawCode);
    const opponentHand = session.state.cards.find((card) => card.code === opponentHandCode);
    const opponentDraw = session.state.cards.find((card) => card.code === opponentDrawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(dragged).toBeDefined();
    expect(ownHand).toBeDefined();
    expect(ownDraw).toBeDefined();
    expect(opponentHand).toBeDefined();
    expect(opponentDraw).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, dragged!.uid, "hand", 0);
    moveDuelCard(session.state, ownHand!.uid, "hand", 0);
    moveDuelCard(session.state, opponentHand!.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(draggedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const draggedAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === dragged!.uid);
    expect(draggedAction).toBeDefined();
    applyAndAssert(session, draggedAction!);
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
        "sourceUid": "p0-deck-16435215-0",
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
        "sourceUid": "p0-deck-16435215-0",
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

    expect(restored.session.state.cards.find((card) => card.uid === dragged!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownHand!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHand!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ownDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDraw!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === responder!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.host.messages).toEqual([
      `confirmed 0: ${opponentHandCode},${responderCode}`,
      `confirmed 1: ${ownHandCode}`,
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["discarded", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: opponentHand!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragged!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: ownHand!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragged!.uid,
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
        eventReasonCardUid: dragged!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [opponentDraw!.uid],
        eventCardUid: opponentDraw!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragged!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("dragged down responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dragged down responder resolved") end)
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
