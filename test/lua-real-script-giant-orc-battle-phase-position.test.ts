import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Giant Orc Battle Phase position", () => {
  it("restores the Battle Phase event after an attack and changes itself to Defense Position", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const giantOrcCode = "73698349";
    const targetCode = "7369";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giantOrcCode),
      { code: targetCode, name: "Giant Orc Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 736, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [giantOrcCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const giantOrc = session.state.cards.find((card) => card.code === giantOrcCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(giantOrc).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, giantOrc!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(giantOrcCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 0x1080 && effect.sourceUid === giantOrc!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 4224,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "event": "continuous",
        "id": "lua-1-4224",
        "luaTypeFlags": 2050,
        "oncePerTurn": true,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:73698349:lua-1-4224",
        "sourceUid": "p0-deck-73698349-0",
        "target": [Function],
        "triggerCode": 4224,
        "triggerEvent": "phaseBattle",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === giantOrc!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(session.state.cards.find((card) => card.uid === giantOrc!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack" });
    expect(session.state.players[1].lifePoints).toBe(6800);
    const main2 = getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.battlePairs).toEqual([{ attackerUid: giantOrc!.uid, targetUid: target!.uid }]);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 0x1080 && effect.sourceUid === giantOrc!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 4224,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "event": "continuous",
        "id": "lua-1-4224",
        "luaTypeFlags": 2050,
        "oncePerTurn": true,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:73698349:lua-1-4224",
        "sourceUid": "p0-deck-73698349-0",
        "target": [Function],
        "triggerCode": 4224,
        "triggerEvent": "phaseBattle",
      }
    `);
    expect(restored.host.messages).toEqual(host.messages);
    const restoredMain2 = getLegalActions(restored.session, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(restoredMain2).toBeDefined();
    const changed = applyResponse(restored.session, restoredMain2!);
    expect(changed.ok, changed.error).toBe(true);
    expect(changed.legalActions).toEqual(getLegalActions(restored.session, changed.state.waitingFor!));
    expect(changed.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, changed.state.waitingFor!));
    expect(changed.legalActionGroups.flatMap((group) => group.actions)).toEqual(changed.legalActions);

    expect(restored.session.state.phase).toBe("main2");
    expect(restored.session.state.battlePairs).toEqual([{ attackerUid: giantOrc!.uid, targetUid: target!.uid }]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle")).toEqual([
      {
        eventName: "phaseBattle",
        eventCode: 0x1080,
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === giantOrc!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === giantOrc!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: giantOrc!.uid,
        eventReason: 64,
        eventReasonPlayer: 0,
        eventReasonCardUid: giantOrc!.uid,
        eventReasonEffectId: 1,
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
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
