import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Desires deck cost", () => {
  it("restores Pot of Desires' face-down banished deck cost and draw operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "35261759";
    const costCodes = ["919", "920", "921", "922", "923", "924", "925", "926", "927", "928"];
    const drawCodes = ["929", "930"];
    const responderCode = "931";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      ...costCodes.map((code, index) => ({ code, name: `Pot of Desires Cost ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      ...drawCodes.map((code, index) => ({ code, name: `Pot of Desires Draw ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      { code: responderCode, name: "Pot of Desires Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 474, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, ...costCodes, ...drawCodes] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const liveDeckUids = getCards(session.state, 0, "deck").map((card) => card.uid);
    const costUids = liveDeckUids.slice(0, 10);
    const drawUids = liveDeckUids.slice(10, 12);
    expect(costUids).toHaveLength(10);
    expect(drawUids).toHaveLength(2);

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
    expect(potAction).toBeDefined();
    applyAndAssert(session, potAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: pot!.uid,
      targetPlayer: 0,
      targetParam: 2,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 }],
    });
    for (const uid of costUids) {
      expect(session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: false,
        position: "faceDownDefense",
        reason: 0x80,
      });
    }
    expect(session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      ...costUids.map((uid, sequence) => ({
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: sequence < 2 ? sequence : sequence + 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence,
        },
      })),
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: costUids[0],
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventUids: costUids,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "banished",
          position: "faceDownDefense",
          sequence: 0,
        },
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: pot!.uid,
      targetPlayer: 0,
      targetParam: 2,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 }],
    });
    for (const uid of costUids) {
      expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: false,
        position: "faceDownDefense",
        reason: 0x80,
      });
    }

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    for (const uid of drawUids) expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventCardUid: drawUids[0],
        eventValue: 2,
        eventUids: drawUids,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 11,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === pot!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).not.toContain("pot of desires responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("pot of desires responder resolved") end)
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
  return response;
}
