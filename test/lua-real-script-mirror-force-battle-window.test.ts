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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirror Force battle window", () => {
  it("restores Mirror Force and destroys only attack-position opposing monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirrorForceCode = "44095762";
    const responderCode = "860";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorForceCode),
      { code: responderCode, name: "Mirror Force Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "100", name: "Mirror Force Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Mirror Force Second Attacker", kind: "monster", attack: 1700, defense: 1000 },
      { code: "102", name: "Mirror Force Defense Ally", kind: "monster", attack: 900, defense: 2000 },
      { code: "200", name: "Mirror Force Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 454, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "101", "102", responderCode] }, 1: { main: [mirrorForceCode, "200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const secondAttacker = session.state.cards.find((card) => card.code === "101");
    const defenseAlly = session.state.cards.find((card) => card.code === "102");
    const target = session.state.cards.find((card) => card.code === "200");
    const mirrorForce = session.state.cards.find((card) => card.code === mirrorForceCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(attacker).toBeDefined();
    expect(secondAttacker).toBeDefined();
    expect(defenseAlly).toBeDefined();
    expect(target).toBeDefined();
    expect(mirrorForce).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, secondAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defenseAlly!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, mirrorForce!.uid, "spellTrapZone", 1);
    mirrorForce!.position = "faceDown";
    mirrorForce!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirrorForceCode), source).ok).toBe(true);
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
    const mirrorForceAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === mirrorForce!.uid);
    expect(mirrorForceAction).toBeDefined();
    applyAndAssert(session, mirrorForceAction!);
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
          "sequence": 2,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-100-0",
              "p0-deck-101-1",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-44095762-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [attacker!.uid, secondAttacker!.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === secondAttacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === defenseAlly!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.cards.find((card) => card.uid === mirrorForce!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === secondAttacker!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: secondAttacker!.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: mirrorForce!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restored.host.messages).not.toContain("mirror force responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("mirror force responder resolved") end)
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
