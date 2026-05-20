import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const armorMasterCode = "69031175";
const targetCode = "690311750";
const wedgeCounter = 0x1002;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blackwing Armor Master counter stat", () => {
  it("restores battle immunity, end-Damage-Step Wedge Counter placement, and counter-cost final ATK/DEF zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${armorMasterCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("Duel.GetAttacker()==e:GetHandler()");
    expect(script).toContain("atg:AddCounter(0x1002,1)");
    expect(script).toContain("t:RemoveCounter(tp,0x1002,t:GetCounter(0x1002),REASON_COST)");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === armorMasterCode),
      { code: targetCode, name: "Armor Master Wedge Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 2400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 69031175, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [armorMasterCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const armorMaster = requireCard(session, armorMasterCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, armorMaster, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(armorMasterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === armorMaster.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], value: undefined },
      { code: 42, event: "continuous", range: ["monsterZone"], value: 1 },
      { code: 201, event: "continuous", range: ["monsterZone"], value: 1 },
      { code: 1141, event: "trigger", range: ["monsterZone"], value: undefined },
      { code: undefined, event: "ignition", range: ["monsterZone"], value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === armorMaster.uid && action.targetUid === target.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredUntilPendingTrigger(restoredBattle);

    expect(restoredBattle.session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === armorMaster.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);
    expect(restoredBattle.session.state.pendingTriggers).toMatchObject([
      {
        eventName: "damageStepEnded",
        eventCode: 1141,
        player: 0,
        sourceUid: armorMaster.uid,
        eventCardUid: armorMaster.uid,
        eventUids: [armorMaster.uid, target.uid],
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === armorMaster.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), wedgeCounter)).toBe(1);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: target.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0x40,
        eventReasonPlayer: 0,
        eventReasonCardUid: armorMaster.uid,
        eventReasonEffectId: 4,
      },
    ]);

    passRestoredBattleResponses(restoredTrigger);
    restoredTrigger.session.state.phase = "main1";
    restoredTrigger.session.state.waitingFor = 0;
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    expect(getDuelCardCounter(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), wedgeCounter)).toBe(1);

    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === armorMaster.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(getDuelCardCounter(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), wedgeCounter)).toBe(0);
    expect(restoredIgnition.session.state.chain).toEqual([]);
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), restoredIgnition.session.state)).toBe(0);
    expect(currentDefense(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), restoredIgnition.session.state)).toBe(0);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 1107169792 }, value: 0 },
      { code: 106, event: "continuous", reset: { flags: 1107169792 }, value: 0 },
    ]);

    const restoredFinalStats = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), workspace, reader);
    expectCleanRestore(restoredFinalStats);
    expect(currentAttack(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0);
    expect(currentDefense(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
