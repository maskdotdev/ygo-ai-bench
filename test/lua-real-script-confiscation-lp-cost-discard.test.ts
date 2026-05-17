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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Confiscation LP cost discard", () => {
  it("restores Confiscation's LP cost, opponent hand confirmation, and selected discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const confiscationCode = "17375316";
    const opponentHandACode = "17375317";
    const opponentHandBCode = "17375318";
    const responderCode = "17375319";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === confiscationCode),
      { code: opponentHandACode, name: "Confiscation Opponent Hand A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentHandBCode, name: "Confiscation Opponent Hand B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Confiscation Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 173, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [confiscationCode] }, 1: { main: [opponentHandACode, opponentHandBCode, responderCode] } });
    startDuel(session);

    const confiscation = session.state.cards.find((card) => card.code === confiscationCode);
    const opponentHandA = session.state.cards.find((card) => card.code === opponentHandACode);
    const opponentHandB = session.state.cards.find((card) => card.code === opponentHandBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(confiscation).toBeDefined();
    expect(opponentHandA).toBeDefined();
    expect(opponentHandB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, confiscation!.uid, "hand", 0);
    moveDuelCard(session.state, opponentHandA!.uid, "hand", 1);
    moveDuelCard(session.state, opponentHandB!.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(confiscationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const confiscationAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === confiscation!.uid);
    expect(confiscationAction).toBeDefined();
    applyAndAssert(session, confiscationAction!);
    expect(session.state.players[0].lifePoints).toBe(7000);
    expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: confiscation!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 128,
            "count": 0,
            "parameter": 1,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-17375316-0",
        "targetPlayer": 0,
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x80, targetUids: [], count: 0, player: 1, parameter: 1 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.players[0].lifePoints).toBe(7000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: confiscation!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 128,
            "count": 0,
            "parameter": 1,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-17375316-0",
        "targetPlayer": 0,
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x80, targetUids: [], count: 0, player: 1, parameter: 1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === confiscation!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHandA!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHandB!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === responder!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "sentToHandConfirmed", "discarded"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 0,
        eventUids: [opponentHandA!.uid, opponentHandB!.uid, responder!.uid],
        eventValue: 3,
        eventCardUid: opponentHandA!.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 0,
        eventUids: [opponentHandA!.uid, opponentHandB!.uid, responder!.uid],
        eventValue: 3,
        eventCardUid: opponentHandA!.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: opponentHandA!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: confiscation!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).toEqual([`confirmed 0: ${opponentHandACode},${opponentHandBCode},${responderCode}`]);
    expect(restored.host.messages).not.toContain("confiscation responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("confiscation responder resolved") end)
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
