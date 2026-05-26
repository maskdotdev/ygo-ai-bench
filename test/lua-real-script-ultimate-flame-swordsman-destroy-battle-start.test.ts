import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const swordsmanCode = "324483";
const hasSwordsmanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swordsmanCode}.lua`));
const destroyTargetCode = "3244830";
const battleTargetCode = "3244831";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasSwordsmanScript)("Lua real script Ultimate Flame Swordsman destroy battle start", () => {
  it("restores targeted monster destruction damage and battle-start final ATK delayed self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${swordsmanCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,CARD_FLAME_SWORDSMAN,36319131)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("return #e:GetHandler():GetEquipGroup()>0");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,500)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
    expect(script).toContain("aux.DelayedOperation(c,PHASE_END,id,e,tp,function(cc) Duel.Destroy(cc,REASON_EFFECT) end)");

    const cards = fixtureCards();
    const reader = createCardReader(cards);
    const source = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const session = createSession(reader);
    const swordsman = requireCard(session, swordsmanCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveFaceUpAttack(session, swordsman.uid, 0);
    moveFaceUpAttack(session, destroyTarget.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(swordsmanCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const activation = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === swordsman.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in activation! ? activation.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredIgnition, activation!);
    expect(restoredIgnition.session.state.chain).toEqual([]);
    expect(restoredIgnition.session.state.players[1]!.lifePoints).toBe(7500);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: effectDestroyReason,
      reasonPlayer: 0,
      reasonCardUid: swordsman.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["destroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyTarget.uid,
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: swordsman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: swordsman.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const battleSession = createSession(reader);
    const battleSwordsman = requireCard(battleSession, swordsmanCode);
    const battleTarget = requireCard(battleSession, battleTargetCode);
    moveFaceUpAttack(battleSession, battleSwordsman.uid, 0);
    moveFaceUpAttack(battleSession, battleTarget.uid, 1);
    battleSession.state.phase = "battle";
    battleSession.state.turnPlayer = 0;
    battleSession.state.waitingFor = 0;

    const battleHost = createLuaScriptHost(battleSession, source);
    expect(battleHost.loadCardScript(Number(swordsmanCode), source).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === battleSwordsman.uid && action.targetUid === battleTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle, "battleStarted");

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleSwordsman.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleTrigger, trigger!);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleSwordsman.uid), restoredBattleTrigger.session.state)).toBe(5600);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleSwordsman.uid && effect.code === 102)).toMatchObject([
      { code: 102, event: "continuous", sourceUid: battleSwordsman.uid, value: 5600 },
    ]);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleSwordsman.uid && effect.code === 0x1200)).toEqual([
      expect.objectContaining({ code: 0x1200 }),
    ]);
    passRestoredBattleResponses(restoredBattleTrigger);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === battleSwordsman.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: effectDestroyReason,
      reasonPlayer: 0,
      reasonCardUid: battleSwordsman.uid,
    });
    expect(restoredEnd.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === battleSwordsman.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: battleSwordsman.uid,
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: battleSwordsman.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAfterEnd = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), source, reader);
    expectCleanRestore(restoredAfterEnd);
    expectRestoredLegalActions(restoredAfterEnd, 0);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: swordsmanCode, name: "Ultimate Flame Swordsman", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 8, attack: 2800, defense: 1600 },
    { code: destroyTargetCode, name: "Ultimate Flame Swordsman Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    { code: battleTargetCode, name: "Ultimate Flame Swordsman Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 324483, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [swordsmanCode] }, 1: { main: [destroyTargetCode, battleTargetCode] } });
  startDuel(session);
  return session;
}

function moveFaceUpAttack(session: DuelSession, uid: string, controller: PlayerId) {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  return card;
}

function requireCard(session: DuelSession, code: string) {
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelAction | DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restored, pass!);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
