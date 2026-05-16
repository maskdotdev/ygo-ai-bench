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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Negate Attack battle window", () => {
  it("restores and resolves Negate Attack from the Project Ignis attack-declaration script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const negateAttackCode = "14315573";
    const responderCode = "861";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === negateAttackCode),
      { code: responderCode, name: "Negate Attack Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "100", name: "First Real-Script Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Second Real-Script Attacker", kind: "monster", attack: 1700, defense: 1000 },
      { code: "200", name: "Real-Script Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 451, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "101", responderCode] }, 1: { main: [negateAttackCode, "200"] } });
    startDuel(session);

    const firstAttacker = session.state.cards.find((card) => card.code === "100");
    const secondAttacker = session.state.cards.find((card) => card.code === "101");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const target = session.state.cards.find((card) => card.code === "200");
    const negateAttack = session.state.cards.find((card) => card.code === negateAttackCode);
    expect(firstAttacker).toBeDefined();
    expect(secondAttacker).toBeDefined();
    expect(responder).toBeDefined();
    expect(target).toBeDefined();
    expect(negateAttack).toBeDefined();
    moveDuelCard(session.state, firstAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, secondAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, negateAttack!.uid, "spellTrapZone", 1);
    negateAttack!.position = "faceDown";
    negateAttack!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(negateAttackCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === firstAttacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 0) {
      const turnPlayerPass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
      expect(turnPlayerPass).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }
    expect(queryPublicState(session)).toMatchObject({ phase: "battle", waitingFor: 1, windowKind: "battle" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const negateAction = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid === negateAttack!.uid);
    expect(negateAction, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();

    const activated = applyLuaRestoreResponse(restored, negateAction!);
    expect(activated.ok, activated.error).toBe(true);
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
          "sequence": 0,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "id": "chain-3",
        "player": 1,
        "sourceUid": "p1-deck-14315573-0",
        "targetUids": [
          "p0-deck-100-0",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.attackCanceledUids).toEqual([firstAttacker!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === negateAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.skippedPhases).toEqual([{ player: 0, phase: "battle", remaining: 1 }]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled")).toEqual([
      {
        eventName: "attackDisabled",
        eventCode: 1142,
        eventCardUid: firstAttacker!.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: negateAttack!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("negate attack responder resolved");
    expect(queryPublicState(restored.session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "open" });
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "declareAttack" && action.attackerUid === secondAttacker!.uid)).toBe(false);

    const main2 = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();
    const advanced = applyLuaRestoreResponse(restored, main2!);
    expect(advanced.ok, advanced.error).toBe(true);
    expect(restored.session.state.phase).toBe("main2");
    expect(restored.session.state.skippedPhases).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("negate attack responder resolved") end)
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
