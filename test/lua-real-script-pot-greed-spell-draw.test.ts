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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Greed Spell draw", () => {
  it("restores Pot of Greed's normal Spell activation and two-card draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "55144522";
    const firstDrawCode = "55144523";
    const secondDrawCode = "55144524";
    const responderCode = "55144525";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      { code: firstDrawCode, name: "Pot of Greed First Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: secondDrawCode, name: "Pot of Greed Second Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Pot of Greed Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 551, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, firstDrawCode, secondDrawCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const firstDraw = session.state.cards.find((card) => card.code === firstDrawCode);
    const secondDraw = session.state.cards.find((card) => card.code === secondDrawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(firstDraw).toBeDefined();
    expect(secondDraw).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
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
    expect(potAction).toBeDefined();
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
            "category": 65536,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-55144522-0",
        "targetParam": 2,
        "targetPlayer": 0,
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
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
            "category": 65536,
            "count": 0,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-55144522-0",
        "targetParam": 2,
        "targetPlayer": 0,
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === pot!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === firstDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === secondDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [secondDraw!.uid, firstDraw!.uid],
        eventCardUid: secondDraw!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("pot of greed responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("pot of greed responder resolved") end)
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
