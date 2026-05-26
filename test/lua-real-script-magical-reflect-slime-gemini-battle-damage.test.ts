import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magical Reflect Slime Gemini battle damage", () => {
  it("restores Gemini status and reflects battle damage after a second Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const slimeCode = "3918345";
    const strongerTargetCode = "3918";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === slimeCode),
      { code: strongerTargetCode, name: "Magical Reflect Slime Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 391, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slimeCode] }, 1: { main: [strongerTargetCode] } });
    startDuel(session);

    const slime = session.state.cards.find((card) => card.code === slimeCode);
    const target = session.state.cards.find((card) => card.code === strongerTargetCode);
    expect(slime).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, slime!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    slime!.faceUp = true;
    slime!.position = "faceUpAttack";
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slimeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 202 && effect.sourceUid === slime!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 202,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-202",
        "luaConditionDescriptor": "condition:gemini-status",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:3918345:lua-4-202",
        "sourceUid": "p0-deck-3918345-0",
        "target": [Function],
        "value": 1,
      }
    `);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    assertGeminiStatus(restoredSummonWindow, slimeCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === slime!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restoredSummonWindow, geminiSummon!);
    expect(summoned.ok, summoned.error).toBe(true);

    const restoredBattleEntry = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expect(restoredBattleEntry.restoreComplete, restoredBattleEntry.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleEntry.missingRegistryKeys).toEqual([]);
    expect(restoredBattleEntry.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleEntry, 0);
    assertGeminiStatus(restoredBattleEntry, slimeCode, true);
    expect(restoredBattleEntry.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 202 && effect.sourceUid === slime!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 202,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-202",
        "luaConditionDescriptor": "condition:gemini-status",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:3918345:lua-4-202",
        "sourceUid": "p0-deck-3918345-0",
        "target": [Function],
        "value": 1,
      }
    `);
    const battlePhase = getLuaRestoreLegalActions(restoredBattleEntry, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEntry, 0), null, 2)).toBeDefined();
    const enteredBattle = applyLuaRestoreResponse(restoredBattleEntry, battlePhase!);
    expect(enteredBattle.ok, enteredBattle.error).toBe(true);

    const restoredAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEntry.session), workspace, reader);
    expect(restoredAttackWindow.restoreComplete, restoredAttackWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAttackWindow.missingRegistryKeys).toEqual([]);
    expect(restoredAttackWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAttackWindow, 0);
    assertGeminiStatus(restoredAttackWindow, slimeCode, true);
    const attack = getLuaRestoreLegalActions(restoredAttackWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === slime!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackWindow, 0), null, 2)).toBeDefined();
    const attacked = applyLuaRestoreResponse(restoredAttackWindow, attack!);
    expect(attacked.ok, attacked.error).toBe(true);
    expect(restoredAttackWindow.session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restoredDamageWindow = restoreDuelWithLuaScripts(serializeDuel(restoredAttackWindow.session), workspace, reader);
    expect(restoredDamageWindow.restoreComplete, restoredDamageWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageWindow.missingRegistryKeys).toEqual([]);
    expect(restoredDamageWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageWindow, 1);
    passBattleResponses(restoredDamageWindow.session);

    expect(restoredDamageWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 1300 });
    expect(restoredDamageWindow.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredDamageWindow.session.state.players[1].lifePoints).toBe(6700);
    expect(restoredDamageWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: slime!.uid,
        eventPlayer: 1,
        eventValue: 1300,
        eventReason: duelReason.battle,
        eventReasonCardUid: slime!.uid,
        eventReasonPlayer: 0,
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
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredDamageWindow.session.state.cards.find((card) => card.uid === slime!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredDamageWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("magical reflect slime gemini status " .. tostring(target and target:IsGeminiStatus()))
    `,
    "magical-reflect-slime-gemini-status-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`magical reflect slime gemini status ${expected ? "true" : "false"}`);
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
