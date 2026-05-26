import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pantherCode = "97165977";
const firstTargetCode = "971659770";
const secondTargetCode = "971659771";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPantherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pantherCode}.lua`));
const typeMonster = 0x1;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectIndestructibleCount = 47;
const effectUpdateAttack = 100;
const effectAttackAll = 193;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPantherScript)("Lua real script Lunalight Panther Dancer attack all stat", () => {
  it("restores attack-all ignition into battle-destroying ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pantherCode}.lua`);
    expect(script).toContain("--Lunalight Panther Dancer");
    expect(script).toContain("Fusion.AddProcMix(c,false,false,51777272,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_LUNALIGHT))");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e2:SetValue(aux.indoval)");
    expect(script).toContain("return Duel.IsAbleToEnterBP()");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
    expect(script).toContain("e1:SetTargetRange(0,LOCATION_MZONE)");
    expect(script).toContain("e2:SetCode(EFFECT_ATTACK_ALL)");
    expect(script).toContain("e2:SetValue(2)");
    expect(script).toContain("e4:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("e4:SetCondition(aux.bdocon)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(200)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 97165977, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [pantherCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const panther = requireCard(session, pantherCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveFaceUpAttack(session, panther, 0, 0);
    moveFaceUpAttack(session, firstTarget, 1, 0);
    moveFaceUpAttack(session, secondTarget, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pantherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    const ignition = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "activateEffect" && action.uid === panther.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, ignition!);
    expect(restoredMain.session.state.effects.filter((effect) =>
      (effect.sourceUid === panther.uid && effect.code === effectAttackAll) || (effect.code === effectIndestructibleCount && effect.controller === 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaValueDescriptor: effect.luaValueDescriptor,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleCount, event: "continuous", luaValueDescriptor: "value-predicate:reason-mask:32", property: undefined, reset: { flags: 1073742336 }, sourceUid: panther.uid, targetRange: [0, 4], value: undefined },
      { code: effectAttackAll, event: "continuous", luaValueDescriptor: undefined, property: 1024, reset: { flags: 1107169792 }, sourceUid: panther.uid, targetRange: undefined, value: 2 },
    ]);

    const restoredBattleEntry = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), workspace, reader);
    expectCleanRestore(restoredBattleEntry);
    restoredBattleEntry.session.state.phase = "battle";
    restoredBattleEntry.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattleEntry, 0);
    const attackActions = getLuaRestoreLegalActions(restoredBattleEntry, 0);
    expect(hasAttack(attackActions, panther.uid, firstTarget.uid)).toBe(true);
    expect(hasAttack(attackActions, panther.uid, secondTarget.uid)).toBe(true);
    expect(hasDirectAttack(attackActions, panther.uid)).toBe(false);
    const attack = attackActions.find((action) => action.type === "declareAttack" && action.attackerUid === panther.uid && action.targetUid === firstTarget.uid);
    expect(attack, JSON.stringify(attackActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleEntry, attack!);
    finishBattleUntilTrigger(restoredBattleEntry);
    expect(restoredBattleEntry.session.state.pendingTriggers).toEqual([]);
    expect(restoredBattleEntry.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({
      location: "monsterZone",
    });

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEntry.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    expectRestoredLegalActions(restoredSecondAttack, 0);
    const secondAttackActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    const secondAttack = secondAttackActions.find((action) => action.type === "declareAttack" && action.attackerUid === panther.uid && action.targetUid === firstTarget.uid);
    expect(secondAttack, JSON.stringify(secondAttackActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSecondAttack, secondAttack!);
    finishBattleUntilTrigger(restoredSecondAttack);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSecondAttack.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === panther.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: panther.uid,
      reasonPlayer: 0,
    });
    expect(currentAttack(find(restoredTrigger.session, panther.uid), restoredTrigger.session.state)).toBe(3000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === panther.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107234944 }, value: 200 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1800 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pantherCode),
    { code: firstTargetCode, name: "Panther Dancer First Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: secondTargetCode, name: "Panther Dancer Second Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function find(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
