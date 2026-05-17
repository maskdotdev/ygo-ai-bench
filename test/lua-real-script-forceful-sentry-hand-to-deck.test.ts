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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The Forceful Sentry hand to Deck", () => {
  it("restores The Forceful Sentry's opponent hand confirmation and selected hand-to-Deck return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sentryCode = "42829885";
    const opponentHandACode = "42829886";
    const opponentHandBCode = "42829887";
    const responderCode = "42829888";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sentryCode),
      { code: opponentHandACode, name: "Forceful Sentry Opponent Hand A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentHandBCode, name: "Forceful Sentry Opponent Hand B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Forceful Sentry Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 428, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sentryCode] }, 1: { main: [opponentHandACode, opponentHandBCode, responderCode] } });
    startDuel(session);

    const sentry = session.state.cards.find((card) => card.code === sentryCode);
    const opponentHandA = session.state.cards.find((card) => card.code === opponentHandACode);
    const opponentHandB = session.state.cards.find((card) => card.code === opponentHandBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sentry).toBeDefined();
    expect(opponentHandA).toBeDefined();
    expect(opponentHandB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sentry!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(sentryCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const sentryAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sentry!.uid);
    expect(sentryAction).toBeDefined();
    applyAndAssert(session, sentryAction!);
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
            "count": 0,
            "parameter": 2,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-42829885-0",
        "targetPlayer": 0,
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [], count: 0, player: 1, parameter: 2 },
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
            "count": 0,
            "parameter": 2,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-42829885-0",
        "targetPlayer": 0,
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [], count: 0, player: 1, parameter: 2 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === sentry!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHandA!.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHandB!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === responder!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "sentToHandConfirmed", "sentToDeck"].includes(event.eventName))).toEqual([
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
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: opponentHandA!.uid,
        eventPreviousState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 1, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sentry!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).toEqual([`confirmed 0: ${opponentHandACode},${opponentHandBCode},${responderCode}`]);
    expect(restored.host.messages).not.toContain("forceful sentry responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("forceful sentry responder resolved") end)
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
