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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Card Blocker attack retarget", () => {
  it("restores its field battle-target trigger and redirects to itself", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blockerCode = "42256406";
    const attackerCode = "4225";
    const originalTargetCode = "4226";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blockerCode),
      { code: attackerCode, name: "Card Blocker Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: originalTargetCode, name: "Card Blocker Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 422, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [blockerCode, originalTargetCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const blocker = session.state.cards.find((card) => card.code === blockerCode);
    const originalTarget = session.state.cards.find((card) => card.code === originalTargetCode);
    expect(attacker).toBeDefined();
    expect(blocker).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, blocker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blockerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "trigger" && effect.code === 1131 && effect.sourceUid === blocker!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 1131,
        "controller": 1,
        "cost": [Function],
        "description": 676102497,
        "event": "trigger",
        "id": "lua-4-1131",
        "luaTypeFlags": 130,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:42256406:lua-4-1131",
        "sourceUid": "p1-deck-42256406-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1131,
        "triggerEvent": "battleTargeted",
        "triggerTiming": "when",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const redirect = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === blocker!.uid && action.effectId.endsWith("-1131"));
    expect(redirect).toBeDefined();
    const response = applyLuaRestoreResponse(restored, redirect!);
    expect(response.ok, response.error).toBe(true);
    resolveChainIfNeeded(restored);

    expect(restored.session.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: blocker!.uid });
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: blocker!.uid });
    passBattleResponses(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === blocker!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(6600);
    expect(restored.session.state.battleDamage).toMatchObject({ 1: 1400 });
  });
});

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
