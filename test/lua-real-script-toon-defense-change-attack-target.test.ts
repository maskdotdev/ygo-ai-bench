import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeToon = 0x400000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Toon Defense attack retarget", () => {
  it("restores Toon Defense's attack-declaration trigger and changes the attack into a direct attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const toonDefenseCode = "43509019";
    const attackerCode = "4350";
    const toonTargetCode = "4351";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === toonDefenseCode),
      { code: attackerCode, name: "Toon Defense Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: toonTargetCode, name: "Low-Level Toon Target", kind: "monster", typeFlags: typeMonster | typeToon, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 435, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [toonDefenseCode, toonTargetCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const toonTarget = session.state.cards.find((card) => card.code === toonTargetCode);
    const toonDefense = session.state.cards.find((card) => card.code === toonDefenseCode);
    expect(attacker).toBeDefined();
    expect(toonTarget).toBeDefined();
    expect(toonDefense).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, toonTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    const defense = moveDuelCard(session.state, toonDefense!.uid, "spellTrapZone", 1);
    defense.faceUp = true;
    defense.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(toonDefenseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "trigger" && effect.code === 1130 && effect.sourceUid === toonDefense!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 1130,
        "controller": 1,
        "cost": [Function],
        "description": 696144304,
        "event": "trigger",
        "id": "lua-2-1130",
        "luaTypeFlags": 130,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "range": [
          "spellTrapZone",
        ],
        "registryKey": "lua:43509019:lua-2-1130",
        "sourceUid": "p1-deck-43509019-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1130,
        "triggerEvent": "attackDeclared",
        "triggerTiming": "when",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === toonTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: toonTarget!.uid });
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-2-1130",
          "eventCardUid": "p0-deck-4350-0",
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
          "eventTriggerTiming": "when",
          "id": "trigger-3-1",
          "player": 1,
          "sourceUid": "p1-deck-43509019-0",
          "triggerBucket": "opponentOptional",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === toonDefense!.uid);
    expect(trigger).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    resolveChainIfNeeded(restored);

    expect(restored.session.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.session.state.currentAttack?.targetUid).toBeUndefined();
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.session.state.pendingBattle?.targetUid).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === toonTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });

    passBattleResponses(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === toonTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(6200);
    expect(restored.session.state.battleDamage).toMatchObject({ 1: 1800 });
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveChainIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
