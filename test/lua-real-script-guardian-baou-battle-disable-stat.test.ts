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
const baouCode = "73544866";
const equipCode = "68427465";
const defenderCode = "735448660";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBaouScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${baouCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceFiend = 0x20;
const raceWarrior = 0x1;
const effectCannotSummon = 20;
const effectCannotFlipSummon = 21;
const effectSpecialSummonCondition = 30;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasBaouScript)("Lua real script Guardian Baou battle disable stat", () => {
  it("restores Baou equip-gated summon restrictions, battle disable, and battle-destroying ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${baouCode}.lua`);
    expect(script).toContain("--Guardian Baou");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SUMMON)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_FLIP_SUMMON)");
    expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("return not Duel.IsExistingMatchingCard(s.cfilter,e:GetHandlerPlayer(),LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("e4:SetCode(EVENT_BATTLED)");
    expect(script).toContain("bc:IsType(TYPE_EFFECT) and bc:IsStatus(STATUS_BATTLE_DESTROYED)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("e5:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("bc:IsLocation(LOCATION_GRAVE) and bc:IsReason(REASON_BATTLE) and bc:IsMonster()");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 73544866, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [baouCode, equipCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const baou = requireCard(session, baouCode);
    const equip = requireCard(session, equipCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, baou, 0, 0);
    moveFaceUpEquip(session, equip, 0, 0, baou.uid);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(baouCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === baou.uid && [effectCannotSummon, effectCannotFlipSummon, effectSpecialSummonCondition, 1138, 1139].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotSummon, event: "continuous", property: 0x40400, triggerEvent: undefined, value: undefined },
      { code: effectCannotFlipSummon, event: "continuous", property: 0x40400, triggerEvent: undefined, value: undefined },
      { code: effectSpecialSummonCondition, event: "continuous", property: 0x40400, triggerEvent: undefined, value: undefined },
      { code: 1138, event: "continuous", property: undefined, triggerEvent: "afterDamageCalculation", value: undefined },
      { code: 1139, event: "trigger", property: undefined, triggerEvent: "battleDestroyed", value: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === baou.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);
    passBattleUntilTrigger(restoredOpen);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && [effectDisable, effectDisableEffect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDisable, event: "continuous", reset: { flags: 24776704 }, sourceUid: defender.uid },
      { code: effectDisableEffect, event: "continuous", reset: { flags: 24776704 }, sourceUid: defender.uid },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === baou.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, trigger!);
    resolveRestoredChain(restoredBattle);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === baou.uid), restoredBattle.session.state)).toBe(1800);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === baou.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x2000, reset: { flags: 33492992 }, value: 1000 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === baou.uid), restoredStat.session.state)).toBe(1800);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: baouCode, name: "Guardian Baou", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 800, defense: 400 },
    { code: equipCode, name: "Wicked-Breaking Flamberge - Baou", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: defenderCode, name: "Guardian Baou Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 500, defense: 500 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
