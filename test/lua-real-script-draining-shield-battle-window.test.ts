import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Draining Shield battle window", () => {
  it("restores Draining Shield's attack-declaration target and recovers LP after negating the attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const drainingShieldCode = "43250041";
    const responderCode = "860";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === drainingShieldCode),
      { code: responderCode, name: "Draining Shield Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "100", name: "Draining Shield Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Draining Shield Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 456, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", responderCode] }, 1: { main: [drainingShieldCode, "200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const drainingShield = session.state.cards.find((card) => card.code === drainingShieldCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(drainingShield).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, drainingShield!.uid, "spellTrapZone", 1);
    drainingShield!.position = "faceDown";
    drainingShield!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(drainingShieldCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 0) {
      const turnPlayerPass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
      expect(turnPlayerPass).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }
    const shieldAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === drainingShield!.uid);
    expect(shieldAction).toBeDefined();
    applyAndAssert(session, shieldAction!);
    expect(queryPublicState(session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "chainResponse" });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1130",
        "eventCardUid": "p0-deck-100-0",
        "eventCode": 1130,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "attackDeclared",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventUids": [
          "p0-deck-100-0",
          "p1-deck-200-1",
        ],
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1800,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-43250041-0",
        "targetFieldIds": [
          5,
        ],
        "targetUids": [
          "p0-deck-100-0",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1130",
        "eventCardUid": "p0-deck-100-0",
        "eventCode": 1130,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "attackDeclared",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventUids": [
          "p0-deck-100-0",
          "p1-deck-200-1",
        ],
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1800,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-43250041-0",
        "targetFieldIds": [
          5,
        ],
        "targetUids": [
          "p0-deck-100-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x100000, targetUids: [], count: 0, player: 1, parameter: 1800 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(9800);
    expect(restored.session.state.cards.find((card) => card.uid === drainingShield!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: drainingShield!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restored.host.messages).not.toContain("draining shield responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("draining shield responder resolved") end)
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
