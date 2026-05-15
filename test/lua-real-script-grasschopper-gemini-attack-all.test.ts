import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Grasschopper Gemini attack-all", () => {
  it("restores Gemini status into repeat monster attacks without reopening direct attacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const grasschopperCode = "95166228";
    const firstTargetCode = "95166229";
    const secondTargetCode = "95166230";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === grasschopperCode),
      { code: firstTargetCode, name: "Grasschopper First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Grasschopper Second Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9516, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [grasschopperCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const grasschopper = requireCard(session, grasschopperCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveFaceUpAttack(session, grasschopper, 0);
    moveFaceUpAttack(session, firstTarget, 1);
    moveFaceUpAttack(session, secondTarget, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(grasschopperCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 193 && effect.sourceUid === grasschopper.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 193,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-193",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:95166228:lua-4-193",
        "sourceUid": "p0-deck-95166228-0",
        "target": [Function],
        "value": 1,
      }
    `);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    assertGeminiStatus(restoredSummonWindow, grasschopperCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === grasschopper.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, geminiSummon!);

    const restoredBattleEntry = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expectCleanRestore(restoredBattleEntry);
    expectRestoredLegalActions(restoredBattleEntry, 0);
    assertGeminiStatus(restoredBattleEntry, grasschopperCode, true);
    const battlePhase = getLuaRestoreLegalActions(restoredBattleEntry, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEntry, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleEntry, battlePhase!);

    const restoredFirstAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEntry.session), workspace, reader);
    expectCleanRestore(restoredFirstAttackWindow);
    expectRestoredLegalActions(restoredFirstAttackWindow, 0);
    const firstActions = getLuaRestoreLegalActions(restoredFirstAttackWindow, 0);
    expect(hasAttack(firstActions, grasschopper.uid, firstTarget.uid)).toBe(true);
    expect(hasAttack(firstActions, grasschopper.uid, secondTarget.uid)).toBe(true);
    expect(hasDirectAttack(firstActions, grasschopper.uid)).toBe(false);
    const firstAttack = firstActions.find((action) => action.type === "declareAttack" && action.attackerUid === grasschopper.uid && action.targetUid === firstTarget.uid);
    expect(firstAttack).toBeDefined();
    applyLuaRestoreAndAssert(restoredFirstAttackWindow, firstAttack!);
    passBattleResponses(restoredFirstAttackWindow.session);
    expect(restoredFirstAttackWindow.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({ location: "graveyard" });

    const restoredSecondAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredFirstAttackWindow.session), workspace, reader);
    expectCleanRestore(restoredSecondAttackWindow);
    expectRestoredLegalActions(restoredSecondAttackWindow, 0);
    assertGeminiStatus(restoredSecondAttackWindow, grasschopperCode, true);
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttackWindow, 0);
    expect(hasAttack(secondActions, grasschopper.uid, secondTarget.uid)).toBe(true);
    expect(hasAttack(secondActions, grasschopper.uid, firstTarget.uid)).toBe(false);
    expect(hasDirectAttack(secondActions, grasschopper.uid)).toBe(false);
    const probe = restoredSecondAttackWindow.host.loadScript(geminiAttackAllProbeScript(grasschopperCode), "grasschopper-gemini-attack-all-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredSecondAttackWindow.host.messages).toContain("grasschopper gemini attack-all true/true");
  });
});

function geminiAttackAllProbeScript(grasschopperCode: string): string {
  return `
    local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${grasschopperCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("grasschopper gemini attack-all " .. tostring(c and c:IsGeminiStatus()) .. "/" .. tostring(c and c:IsHasEffect(EFFECT_ATTACK_ALL)~=nil))
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
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

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(`
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,nil)
    Debug.Message("grasschopper gemini status " .. tostring(target and target:IsGeminiStatus()))
  `, "grasschopper-gemini-status-probe.lua");
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`grasschopper gemini status ${expected ? "true" : "false"}`);
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
