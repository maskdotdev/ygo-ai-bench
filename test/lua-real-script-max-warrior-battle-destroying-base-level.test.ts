import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const maxWarriorCode = "94538053";
const battleTargetCode = "945380530";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMaxWarriorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maxWarriorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const effectSetBaseAttack = 103;
const effectSetBaseDefense = 107;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasMaxWarriorScript)("Lua real script Max Warrior battle destroying base level", () => {
  it("restores battle-destroying trigger into base ATK/DEF halving and level change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${maxWarriorCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createBattleSession({ reader, workspace });
    const maxWarrior = requireCard(session, maxWarriorCode);
    const target = requireCard(session, battleTargetCode);

    expect(currentAttack(maxWarrior, session.state)).toBe(1800);
    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === maxWarrior.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleUntilTrigger(session);
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: maxWarrior.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1139",
        eventCardUid: maxWarrior.uid,
        eventCode: 1140,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: maxWarrior.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-6-1",
        player: 0,
        sourceUid: maxWarrior.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === maxWarrior.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const restoredMaxWarrior = findCard(restoredTrigger.session, maxWarrior.uid);
    expect(currentAttack(restoredMaxWarrior, restoredTrigger.session.state)).toBe(900);
    expect(currentDefense(restoredMaxWarrior, restoredTrigger.session.state)).toBe(400);
    expect(currentLevel(restoredMaxWarrior, restoredTrigger.session.state)).toBe(2);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === maxWarrior.uid && [effectSetBaseAttack, effectSetBaseDefense, effectChangeLevel].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetBaseAttack, reset: { flags: 1375670274 }, sourceUid: maxWarrior.uid, value: 900 },
      { code: effectSetBaseDefense, reset: { flags: 1375670274 }, sourceUid: maxWarrior.uid, value: 400 },
      { code: effectChangeLevel, reset: { flags: 1375670274 }, sourceUid: maxWarrior.uid, value: 2 },
    ]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const persistentMaxWarrior = findCard(restoredStat.session, maxWarrior.uid);
    expect(currentAttack(persistentMaxWarrior, restoredStat.session.state)).toBe(900);
    expect(currentDefense(persistentMaxWarrior, restoredStat.session.state)).toBe(400);
    expect(currentLevel(persistentMaxWarrior, restoredStat.session.state)).toBe(2);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: maxWarriorCode, name: "Max Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1800, defense: 800 },
    { code: battleTargetCode, name: "Max Warrior Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 800, defense: 800 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 94538053, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [maxWarriorCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, maxWarriorCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(maxWarriorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Max Warrior");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return (ph==PHASE_DAMAGE or ph==PHASE_DAMAGE_CAL)");
  expect(script).toContain("Duel.GetAttacker()==e:GetHandler() and Duel.GetAttackTarget()~=nil");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("return e:GetHandler():IsRelateToBattle() and e:GetHandler():IsFaceup()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e1:SetValue(c:GetBaseAttack()/2)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_BASE_DEFENSE)");
  expect(script).toContain("e2:SetValue(c:GetBaseDefense()/2)");
  expect(script).toContain("e3:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e3:SetValue(2)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
