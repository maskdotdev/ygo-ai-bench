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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Reload hand to Deck draw", () => {
  it("restores Reload's whole-hand return to Deck, shuffle, break effect, and draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reloadCode = "22589918";
    const handACode = "22589919";
    const handBCode = "22589920";
    const drawACode = "22589921";
    const drawBCode = "22589922";
    const responderCode = "22589923";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === reloadCode),
      { code: handACode, name: "Reload Returned Hand A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: handBCode, name: "Reload Returned Hand B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawACode, name: "Reload Draw A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawBCode, name: "Reload Draw B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Reload Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 225, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reloadCode, handACode, handBCode, drawACode, drawBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const reload = session.state.cards.find((card) => card.code === reloadCode);
    const handA = session.state.cards.find((card) => card.code === handACode);
    const handB = session.state.cards.find((card) => card.code === handBCode);
    const drawA = session.state.cards.find((card) => card.code === drawACode);
    const drawB = session.state.cards.find((card) => card.code === drawBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(reload).toBeDefined();
    expect(handA).toBeDefined();
    expect(handB).toBeDefined();
    expect(drawA).toBeDefined();
    expect(drawB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, reload!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(reloadCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const reloadAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === reload!.uid);
    expect(reloadAction).toBeDefined();
    applyAndAssert(session, reloadAction!);
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
            "count": 1,
            "parameter": 2,
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
        "sourceUid": "p0-deck-22589918-0",
        "targetPlayer": 0,
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [], count: 1, player: 0, parameter: 2 },
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
            "category": 16,
            "count": 1,
            "parameter": 2,
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
        "sourceUid": "p0-deck-22589918-0",
        "targetPlayer": 0,
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [], count: 1, player: 0, parameter: 2 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === reload!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === handA!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === handB!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === drawA!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === drawB!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: handA!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reload!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: handB!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 2, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "deck", sequence: 3, position: "faceDown", faceUp: false },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reload!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: handA!.uid,
        eventUids: [handA!.uid, handB!.uid],
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reload!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [drawB!.uid, handA!.uid],
        eventCardUid: drawB!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: reload!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("reload responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("reload responder resolved") end)
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
