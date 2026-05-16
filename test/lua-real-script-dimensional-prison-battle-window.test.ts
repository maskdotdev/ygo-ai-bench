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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dimensional Prison battle window", () => {
  it("restores Dimensional Prison's attack-declaration target and banishes the active attacker", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dimensionalPrisonCode = "70342110";
    const responderCode = "860";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dimensionalPrisonCode),
      { code: responderCode, name: "Dimensional Prison Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "100", name: "Dimensional Prison Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Dimensional Prison Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 458, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", responderCode] }, 1: { main: [dimensionalPrisonCode, "200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const dimensionalPrison = session.state.cards.find((card) => card.code === dimensionalPrisonCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(dimensionalPrison).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, dimensionalPrison!.uid, "spellTrapZone", 1);
    dimensionalPrison!.position = "faceDown";
    dimensionalPrison!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dimensionalPrisonCode), source).ok).toBe(true);
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
    const prisonAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === dimensionalPrison!.uid);
    expect(prisonAction).toBeDefined();
    applyAndAssert(session, prisonAction!);
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
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-100-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-70342110-0",
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
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-100-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-70342110-0",
        "targetUids": [
          "p0-deck-100-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x4, targetUids: [attacker!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "banished", faceUp: true, position: "faceUpAttack" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.cards.find((card) => card.uid === dimensionalPrison!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === attacker!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: attacker!.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: dimensionalPrison!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restored.host.messages).not.toContain("dimensional prison responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dimensional prison responder resolved") end)
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
