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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cosmic Cyclone free-chain target", () => {
  it("restores Cosmic Cyclone's LP cost, backrow target, and banish operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cosmicCode = "8267140";
    const starterCode = "894";
    const responderCode = "895";
    const targetTrapCode = "896";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cosmicCode),
      { code: starterCode, name: "Cosmic Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Cosmic Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: targetTrapCode, name: "Cosmic Target Backrow", kind: "trap", typeFlags: 0x4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 467, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, targetTrapCode] }, 1: { main: [cosmicCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const targetTrap = session.state.cards.find((card) => card.code === targetTrapCode);
    const cosmic = session.state.cards.find((card) => card.code === cosmicCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(targetTrap).toBeDefined();
    expect(cosmic).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, targetTrap!.uid, "spellTrapZone", 0);
    targetTrap!.position = "faceDown";
    targetTrap!.faceUp = false;
    moveDuelCard(session.state, cosmic!.uid, "spellTrapZone", 1);
    cosmic!.position = "faceDown";
    cosmic!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cosmicCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const cosmicAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === cosmic!.uid);
    expect(cosmicAction).toBeDefined();
    applyAndAssert(session, cosmicAction!);
    expect(session.state.players[1].lifePoints).toBe(7000);
    const costEvent = {
      eventName: "lifePointCostPaid",
      eventCode: 1201,
      eventPlayer: 1,
      eventValue: 1000,
      eventReason: duelReason.cost,
      eventReasonPlayer: 1,
      eventReasonCardUid: cosmic!.uid,
      eventReasonEffectId: 3,
    };
    expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([costEvent]);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-896-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-8267140-0",
        "targetUids": [
          "p0-deck-896-2",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.players[1].lifePoints).toBe(7000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([costEvent]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-896-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-8267140-0",
        "targetUids": [
          "p0-deck-896-2",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === targetTrap!.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === cosmic!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("cosmic chain starter resolved");
    expect(restored.host.messages).not.toContain("cosmic chain responder resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("cosmic chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("cosmic chain responder resolved") end)
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
