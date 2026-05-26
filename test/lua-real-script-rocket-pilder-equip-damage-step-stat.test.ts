import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pilderCode = "27863269";
const attackerCode = "278632690";
const defenderCode = "278632691";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPilderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pilderCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceMachine = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectIndestructibleBattle = 42;
const effectUpdateAttack = 100;
const eventDamageStepEnd = 1141;

describe.skipIf(!hasUpstreamScripts || !hasPilderScript)("Lua real script Rocket Pilder equip damage step stat", () => {
  it("restores equip battle indestructibility and Damage Step End target ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pilderCode}.lua`);
    expect(script).toContain("--Rocket Pilder");
    expect(script).toContain("aux.AddEquipProcedure(c)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("return Duel.GetAttacker()==e:GetHandler():GetEquipTarget()");
    expect(script).toContain("e4:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("Duel.GetAttackTarget()");
    expect(script).toContain("at:IsRelateToBattle() and at:IsFaceup() and Duel.GetAttacker()==e:GetHandler():GetEquipTarget()");
    expect(script).toContain("local atk=c:GetEquipTarget():GetAttack()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-atk)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 27863269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pilderCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const pilder = requireCard(session, pilderCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    moveFaceUpEquip(session, pilder, 0, 0, attacker.uid);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pilderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === pilder.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { code: 76, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: effectIndestructibleBattle, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: eventDamageStepEnd, event: "trigger", range: ["spellTrapZone"], triggerEvent: "damageStepEnded" },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);
    passBattleUntilTrigger(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1141", eventCardUid: attacker.uid, eventCode: eventDamageStepEnd, eventName: "damageStepEnded", player: 0, sourceUid: pilder.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pilder.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid), restoredTrigger.session.state)).toBe(500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, value: -1000 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(restoredStat.session.state.cards.find((card) => card.uid === pilder.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: attacker.uid });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === defender.uid), restoredStat.session.state)).toBe(500);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: pilderCode, name: "Rocket Pilder", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: attackerCode, name: "Rocket Pilder Equipped Attacker", kind: "monster", typeFlags: typeMonster, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Rocket Pilder Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
