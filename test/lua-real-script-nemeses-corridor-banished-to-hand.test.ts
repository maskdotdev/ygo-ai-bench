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
const setNemeses = 0x13d;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nemeses Corridor banished to hand", () => {
  it("restores Nemeses Corridor's face-up banished Nemeses target and return-to-hand operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const corridorCode = "72090076";
    const banishedNemesesCode = "72090077";
    const banishedDecoyCode = "72090078";
    const responderCode = "72090079";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === corridorCode),
      { code: banishedNemesesCode, name: "Nemeses Corridor Banished Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200, setcodes: [setNemeses] },
      { code: banishedDecoyCode, name: "Nemeses Corridor Banished Decoy", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000, setcodes: [0x123] },
      { code: responderCode, name: "Nemeses Corridor Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 720, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [corridorCode, banishedNemesesCode, banishedDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const corridor = session.state.cards.find((card) => card.code === corridorCode);
    const banishedNemeses = session.state.cards.find((card) => card.code === banishedNemesesCode);
    const banishedDecoy = session.state.cards.find((card) => card.code === banishedDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(corridor).toBeDefined();
    expect(banishedNemeses).toBeDefined();
    expect(banishedDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, corridor!.uid, "monsterZone", 0);
    corridor!.position = "faceUpAttack";
    corridor!.faceUp = true;
    moveDuelCard(session.state, banishedNemeses!.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, banishedDecoy!.uid, "banished", 0).faceUp = true;
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
    expect(host.loadCardScript(Number(corridorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const corridorAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === corridor!.uid);
    expect(corridorAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, corridorAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 32,
            "player": 0,
            "targetUids": [
              "p0-deck-72090077-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-72090076-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-72090077-1",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [banishedNemeses!.uid], count: 1, player: 0, parameter: 0x20 },
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
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 32,
            "player": 0,
            "targetUids": [
              "p0-deck-72090077-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-72090076-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-72090077-1",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [banishedNemeses!.uid], count: 1, player: 0, parameter: 0x20 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === corridor!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === banishedNemeses!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === banishedDecoy!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: banishedNemeses!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: corridor!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, location: "banished", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("nemeses corridor responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("nemeses corridor responder resolved") end)
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
