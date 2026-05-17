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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Hole group destroy", () => {
  it("restores Dark Hole's non-targeting all-monster group destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkHoleCode = "53129443";
    const ownMonsterCode = "53129444";
    const opponentAttackCode = "53129445";
    const opponentDefenseCode = "53129446";
    const responderCode = "53129447";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkHoleCode),
      { code: ownMonsterCode, name: "Dark Hole Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1200 },
      { code: opponentAttackCode, name: "Dark Hole Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: opponentDefenseCode, name: "Dark Hole Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 2000 },
      { code: responderCode, name: "Dark Hole Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 531, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkHoleCode, ownMonsterCode] }, 1: { main: [opponentAttackCode, opponentDefenseCode, responderCode] } });
    startDuel(session);

    const darkHole = session.state.cards.find((card) => card.code === darkHoleCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const opponentAttack = session.state.cards.find((card) => card.code === opponentAttackCode);
    const opponentDefense = session.state.cards.find((card) => card.code === opponentDefenseCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(darkHole).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentAttack).toBeDefined();
    expect(opponentDefense).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, darkHole!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentAttack!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentDefense!.uid, "monsterZone", 1).position = "faceDownDefense";
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
    expect(host.loadCardScript(Number(darkHoleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const darkHoleAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === darkHole!.uid);
    expect(darkHoleAction).toBeDefined();
    applyAndAssert(session, darkHoleAction!);
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
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-53129444-1",
              "p1-deck-53129445-0",
              "p1-deck-53129446-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-53129443-0",
      }
    `);
    expect(sortedUids(session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([
      ownMonster!.uid,
      opponentAttack!.uid,
      opponentDefense!.uid,
    ]));

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
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-53129444-1",
              "p1-deck-53129445-0",
              "p1-deck-53129446-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-53129443-0",
      }
    `);
    expect(sortedUids(restored.session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([
      ownMonster!.uid,
      opponentAttack!.uid,
      opponentDefense!.uid,
    ]));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === darkHole!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDefense!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownMonster!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkHole!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentAttack!.uid,
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
        eventReasonCardUid: darkHole!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentDefense!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 1,
          position: "faceDownDefense",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 1,
          position: "faceDownDefense",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkHole!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownMonster!.uid,
        eventUids: [ownMonster!.uid, opponentAttack!.uid, opponentDefense!.uid],
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkHole!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("dark hole responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dark hole responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
