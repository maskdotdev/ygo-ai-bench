import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const halfCounterCode = "6799227";
const attackerCode = "67992270";
const defenderCode = "67992271";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHalfCounterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${halfCounterCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHalfCounterScript)("Lua real script Half Counter pre-damage target stat", () => {
  it("restores pre-damage attacked monster targeting into half-attacker-base ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${halfCounterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    const attacker = requireCard(restored.session, attackerCode);
    const defender = requireCard(restored.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restored, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passBattleUntilHalfCounter(restored);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    expectRestoredLegalActions(restoredDamage, 0);
    const halfCounter = requireCard(restoredDamage.session, halfCounterCode);
    const activate = getLuaRestoreLegalActions(restoredDamage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === halfCounter.uid && action.effectId === "lua-1-1134"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, activate!);
    resolveRestoredChain(restoredDamage);

    expect(currentAttack(findCard(restoredDamage.session, attacker.uid), restoredDamage.session.state)).toBe(2400);
    expect(currentAttack(findCard(restoredDamage.session, defender.uid), restoredDamage.session.state)).toBe(2200);
    expect(restoredDamage.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: defender.uid, value: 1200 },
    ]);
    expect(restoredDamage.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 1, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCardUid: defender.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const halfCounter = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === halfCounterCode);
  expect(halfCounter).toBeDefined();
  return [
    { ...halfCounter!, kind: "trap", typeFlags: typeTrap },
    { code: attackerCode, name: "Half Counter Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1200 },
    { code: defenderCode, name: "Half Counter Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6799227, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [halfCounterCode, defenderCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, halfCounterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(halfCounterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Half Counter");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("local t=Duel.GetAttackTarget()");
  expect(script).toContain("return t and t:IsControler(tp)");
  expect(script).toContain("local tg=Duel.GetAttackTarget()");
  expect(script).toContain("Duel.GetAttacker():IsOnField()");
  expect(script).toContain("tg:IsCanBeEffectTarget(e)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("local atk=Duel.GetAttacker():GetBaseAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(atk/2)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.sequence = sequence;
  return moved;
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

function passBattleUntilHalfCounter(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === requireCard(restored.session, halfCounterCode).uid)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
