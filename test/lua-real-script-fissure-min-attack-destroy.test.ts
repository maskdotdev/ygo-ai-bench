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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fissure minimum attack destroy", () => {
  it("restores Fissure's minimum-ATK opponent monster destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fissureCode = "66788016";
    const ownMonsterCode = "66788017";
    const opponentHighAttackCode = "66788018";
    const opponentLowAttackCode = "66788019";
    const opponentFacedownCode = "66788020";
    const responderCode = "66788021";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fissureCode),
      { code: ownMonsterCode, name: "Fissure Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 700, defense: 1200 },
      { code: opponentHighAttackCode, name: "Fissure High Attack Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: opponentLowAttackCode, name: "Fissure Low Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 2000 },
      { code: opponentFacedownCode, name: "Fissure Facedown Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 1600 },
      { code: responderCode, name: "Fissure Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 667, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fissureCode, ownMonsterCode] }, 1: { main: [opponentHighAttackCode, opponentLowAttackCode, opponentFacedownCode, responderCode] } });
    startDuel(session);

    const fissure = session.state.cards.find((card) => card.code === fissureCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const opponentHighAttack = session.state.cards.find((card) => card.code === opponentHighAttackCode);
    const opponentLowAttack = session.state.cards.find((card) => card.code === opponentLowAttackCode);
    const opponentFacedown = session.state.cards.find((card) => card.code === opponentFacedownCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(fissure).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentHighAttack).toBeDefined();
    expect(opponentLowAttack).toBeDefined();
    expect(opponentFacedown).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, fissure!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentHighAttack!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentLowAttack!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFacedown!.uid, "monsterZone", 1).position = "faceDownDefense";
    opponentFacedown!.faceUp = false;
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
    expect(host.loadCardScript(Number(fissureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const fissureAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === fissure!.uid);
    expect(fissureAction).toBeDefined();
    applyAndAssert(session, fissureAction!);
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
              "p1-deck-66788019-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-66788016-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentLowAttack!.uid], count: 1, player: 0, parameter: 0 },
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
              "p1-deck-66788019-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-66788016-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentLowAttack!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === fissure!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHighAttack!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentLowAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFacedown!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentLowAttack!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 1,
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
        eventReasonCardUid: fissure!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("fissure responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("fissure responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
}
