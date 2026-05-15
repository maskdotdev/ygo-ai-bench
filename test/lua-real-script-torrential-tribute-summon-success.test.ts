import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { ChainLink, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Torrential Tribute summon-success window", () => {
  it("restores Torrential Tribute's summon-success operation info and destroys every monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const torrentialCode = "53582587";
    const starterCode = "882";
    const responderCode = "883";
    const summonedCode = "884";
    const turnAllyCode = "885";
    const opponentFirstCode = "886";
    const opponentSecondCode = "887";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === torrentialCode),
      { code: starterCode, name: "Torrential Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Torrential Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: summonedCode, name: "Torrential Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: turnAllyCode, name: "Torrential Turn Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: opponentFirstCode, name: "Torrential Opponent First", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: opponentSecondCode, name: "Torrential Opponent Second", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 464, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, starterCode, responderCode, turnAllyCode] }, 1: { main: [torrentialCode, opponentFirstCode, opponentSecondCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const turnAlly = session.state.cards.find((card) => card.code === turnAllyCode);
    const opponentFirst = session.state.cards.find((card) => card.code === opponentFirstCode);
    const opponentSecond = session.state.cards.find((card) => card.code === opponentSecondCode);
    const torrential = session.state.cards.find((card) => card.code === torrentialCode);
    expect(summoned).toBeDefined();
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(turnAlly).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();
    expect(torrential).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, turnAlly!.uid, "monsterZone", 0);
    turnAlly!.position = "faceUpAttack";
    turnAlly!.faceUp = true;
    moveDuelCard(session.state, opponentFirst!.uid, "monsterZone", 1);
    opponentFirst!.position = "faceUpAttack";
    opponentFirst!.faceUp = true;
    moveDuelCard(session.state, opponentSecond!.uid, "monsterZone", 1);
    opponentSecond!.position = "faceUpDefense";
    opponentSecond!.faceUp = true;
    moveDuelCard(session.state, torrential!.uid, "spellTrapZone", 1);
    torrential!.position = "faceDown";
    torrential!.faceUp = false;
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
    expect(host.loadCardScript(Number(torrentialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-1-1100",
        "eventCardUid": "p0-deck-884-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 1,
        },
        "eventName": "normalSummoned",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventReason": 16,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-3",
        "player": 0,
        "sourceUid": "p0-deck-882-1",
      }
    `);

    const torrentialAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === torrential!.uid);
    expect(torrentialAction).toBeDefined();
    applyAndAssert(session, torrentialAction!);
    expect(session.state.chain).toHaveLength(2);
    const destroyedUids = [summoned!.uid, turnAlly!.uid, opponentFirst!.uid, opponentSecond!.uid];
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1100",
        "eventCardUid": "p0-deck-884-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 1,
        },
        "eventName": "normalSummoned",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventReason": 16,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 4,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-886-1",
              "p1-deck-887-2",
              "p0-deck-885-3",
              "p0-deck-884-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-53582587-0",
      }
    `);
    assertDestroyOperationInfo(session.state.chain[1]!, destroyedUids);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1100",
        "eventCardUid": "p0-deck-884-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 1,
        },
        "eventName": "normalSummoned",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventReason": 16,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 4,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-886-1",
              "p1-deck-887-2",
              "p0-deck-885-3",
              "p0-deck-884-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-53582587-0",
      }
    `);
    assertDestroyOperationInfo(restored.session.state.chain[1]!, destroyedUids);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    for (const uid of destroyedUids) {
      expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({ location: "graveyard" });
    }
    expect(restored.session.state.cards.find((card) => card.uid === torrential!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("torrential chain starter resolved");
    expect(restored.host.messages).not.toContain("torrential chain responder resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("torrential chain starter resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("torrential chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertDestroyOperationInfo(link: ChainLink, targetUids: string[]): void {
  expect(link.operationInfos).toHaveLength(1);
  const operationInfo = link.operationInfos?.[0];
  expect(operationInfo).toBeDefined();
  expect(operationInfo!).toMatchObject({ category: 0x1, count: targetUids.length, player: 0, parameter: 0 });
  expect(operationInfo!.targetUids).toHaveLength(targetUids.length);
  expect(operationInfo!.targetUids).toEqual(expect.arrayContaining(targetUids));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
