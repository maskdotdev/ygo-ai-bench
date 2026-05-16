import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hayabusa Knight extra attack", () => {
  it("restores official static extra attack and allows the second attack to become direct", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hayabusaCode = "21015833";
    const targetCode = "21015834";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hayabusaCode),
      { code: targetCode, name: "Hayabusa Extra Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2101, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hayabusaCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const hayabusa = session.state.cards.find((card) => card.code === hayabusaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(hayabusa).toBeDefined();
    expect(target).toBeDefined();
    moveFaceUpAttack(session, hayabusa!.uid, 0);
    moveFaceUpAttack(session, target!.uid, 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hayabusaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    expect(restoredSetup.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 194 && effect.sourceUid === hayabusa!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 194,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-194",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:21015833:lua-1-194",
        "sourceUid": "p0-deck-21015833-0",
        "target": [Function],
        "value": 1,
      }
    `);

    const firstAttack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === hayabusa!.uid && action.targetUid === target!.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, firstAttack!);
    passBattleResponses(restoredSetup);
    expect(restoredSetup.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredSetup.session.state.cards.find((card) => card.uid === hayabusa!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredSetup.session.state.players[1].lifePoints).toBe(7500);

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    expectRestoredLegalActions(restoredSecondAttack, 0);
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    expect(hasAttack(secondActions, hayabusa!.uid, target!.uid)).toBe(false);
    expect(hasDirectAttack(secondActions, hayabusa!.uid)).toBe(true);
  });
});

function moveFaceUpAttack(session: ReturnType<typeof createDuel>, uid: string, player: 0 | 1): void {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  moveDuelCard(session.state, uid, "monsterZone", player);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
