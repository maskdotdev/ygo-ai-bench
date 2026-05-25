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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Soul Taker destroy and recover", () => {
  it("restores Soul Taker's target destroy plus opponent recovery operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const soulTakerCode = "81510157";
    const targetCode = "81510158";
    const ownMonsterCode = "81510159";
    const responderCode = "81510160";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === soulTakerCode),
      { code: targetCode, name: "Soul Taker Face-up Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: ownMonsterCode, name: "Soul Taker Ally Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 2000 },
      { code: responderCode, name: "Soul Taker Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 815, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soulTakerCode, ownMonsterCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const soulTaker = session.state.cards.find((card) => card.code === soulTakerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(soulTaker).toBeDefined();
    expect(target).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, soulTaker!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(soulTakerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const soulTakerAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === soulTaker!.uid);
    expect(soulTakerAction).toBeDefined();
    applyAndAssert(session, soulTakerAction!);
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
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-81510158-0",
            ],
          },
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1000,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-81510157-0",
        "targetFieldIds": [
          7,
        ],
        "targetUids": [
          "p1-deck-81510158-0",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x100000, targetUids: [], count: 0, player: 1, parameter: 1000 },
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
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-81510158-0",
            ],
          },
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1000,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-81510157-0",
        "targetFieldIds": [
          7,
        ],
        "targetUids": [
          "p1-deck-81510158-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x100000, targetUids: [], count: 0, player: 1, parameter: 1000 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === soulTaker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.players[1].lifePoints).toBe(9000);
    expect(restored.session.state.eventHistory.filter((event) => ["destroyed", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: soulTaker!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: soulTaker!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("soul taker responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("soul taker responder resolved") end)
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
