import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const skullgiosCode = "21225115";
const defenderCode = "212251150";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSkullgiosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skullgiosCode}.lua`));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSkullgiosScript)("Lua real script Fossil Dragon Skullgios battle-confirm swap pierce", () => {
  it("restores battle-confirm final ATK/DEF swap into piercing doubled battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${skullgiosCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsRace,RACE_ROCK),s.matfilter)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_CONFIRM)");
    expect(script).toContain("bc:IsRelateToBattle() and bc:HasDefense()");
    expect(script).toContain("e1:SetCode(EFFECT_SWAP_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SWAP_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("e3:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("DOUBLE_DAMAGE");
    expect(script).toContain("return c:IsFusionSummoned()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === skullgiosCode),
      { code: defenderCode, name: "Skullgios Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 2500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21225115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [skullgiosCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const skullgios = requireCard(session, skullgiosCode);
    const defender = requireCard(session, defenderCode);
    const movedSkullgios = moveDuelCard(session.state, skullgios.uid, "monsterZone", 0);
    movedSkullgios.faceUp = true;
    movedSkullgios.position = "faceUpAttack";
    movedSkullgios.summonType = "fusion";
    const movedDefender = moveDuelCard(session.state, defender.uid, "monsterZone", 1);
    movedDefender.faceUp = true;
    movedDefender.position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skullgiosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === skullgios.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle, "battleConfirmed");
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restoredBattle.session.state.pendingTriggers).toMatchObject([
      {
        sourceUid: skullgios.uid,
        eventName: "battleConfirmed",
        eventCode: 1133,
        eventCardUid: skullgios.uid,
        eventUids: [skullgios.uid, defender.uid],
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === skullgios.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid), restoredTrigger.session.state)).toBe(2500);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid), restoredTrigger.session.state)).toBe(1000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && [111, 112].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 111, reset: { flags: 1107169312 }, value: 2500 },
      { code: 112, reset: { flags: 1107169312 }, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.effects.some((effect) => effect.sourceUid === skullgios.uid && effect.code === 208)).toBe(true);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    finishBattle(restoredDamage);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 5000 });
    expect(restoredDamage.session.state.players[1].lifePoints).toBe(3000);
    expect(restoredDamage.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      expect.objectContaining({
        eventName: "battleDamageDealt",
        eventCardUid: skullgios.uid,
        eventPlayer: 1,
        eventValue: 5000,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: skullgios.uid,
      }),
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
