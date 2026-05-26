import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alienWarriorCode = "98719226";
const alienAttackerCode = "987192260";
const alienTargetCode = "987192261";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAlienWarriorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienWarriorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeLight = 0x10;
const setAlien = 0xc;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAlienWarriorScript)("Lua real script Alien Warrior counter battle stat", () => {
  it("restores battle-destroyed A-Counter placement and Alien battle stat loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${alienWarriorCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const destroyedOpen = createRestoredBattleDestroyedScenario(reader, workspace);
    const warrior = requireCard(destroyedOpen.session, alienWarriorCode);
    const attacker = requireCard(destroyedOpen.session, alienAttackerCode);
    expectCleanRestore(destroyedOpen);
    expectRestoredLegalActions(destroyedOpen, 1);
    attackAndReachBattleDestroyedTrigger(destroyedOpen, 1, attacker.uid, warrior.uid);
    expect(destroyedOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: warrior.uid,
        eventPlayer: 0,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        sourceUid: warrior.uid,
        effectId: "lua-1-1140",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);

    const counterTrigger = restoreDuelWithLuaScripts(serializeDuel(destroyedOpen.session), workspace, reader);
    expectCleanRestore(counterTrigger);
    activateTrigger(counterTrigger, warrior.uid, "lua-1-1140");
    resolveRestoredChain(counterTrigger);
    expect(getDuelCardCounter(findCard(counterTrigger.session, attacker.uid), counterA)).toBe(2);
    expect(counterTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: warrior.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: attacker.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: warrior.uid, eventReasonEffectId: 1 },
    ]);

    const statOpen = createRestoredStatScenario(reader, workspace);
    const statWarrior = requireCard(statOpen.session, alienWarriorCode);
    const statAttacker = requireCard(statOpen.session, alienAttackerCode);
    const statTarget = requireCard(statOpen.session, alienTargetCode);
    expectCleanRestore(statOpen);
    expectRestoredLegalActions(statOpen, 1);
    expect(statOpen.session.state.effects.filter((effect) => effect.sourceUid === statWarrior.uid).map(effectSummary)).toEqual([
      {
        category: 0x800000,
        code: 1140,
        event: "trigger",
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        sourceUid: statWarrior.uid,
        targetRange: undefined,
        triggerEvent: "battleDestroyed",
      },
      {
        category: undefined,
        code: 100,
        event: "continuous",
        range: ["monsterZone"],
        sourceUid: statWarrior.uid,
        targetRange: [4, 4],
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: 104,
        event: "continuous",
        range: ["monsterZone"],
        sourceUid: statWarrior.uid,
        targetRange: [4, 4],
        triggerEvent: undefined,
      },
    ]);
    attackAndReachDamageCalculation(statOpen, 1, statAttacker.uid, statTarget.uid);
    expect(currentAttack(findCard(statOpen.session, statAttacker.uid), statOpen.session.state)).toBe(1900);
    expect(currentDefense(findCard(statOpen.session, statAttacker.uid), statOpen.session.state)).toBe(1100);
    expect(currentAttack(findCard(statOpen.session, statTarget.uid), statOpen.session.state)).toBe(800);
    expect(currentDefense(findCard(statOpen.session, statTarget.uid), statOpen.session.state)).toBe(800);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const alienWarrior = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === alienWarriorCode);
  expect(alienWarrior).toBeDefined();
  return [
    alienWarrior!,
    { code: alienAttackerCode, name: "Alien Warrior A-Counter Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeLight, level: 4, attack: 2500, defense: 1700 },
    { code: alienTargetCode, name: "Alien Warrior Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeLight, level: 4, attack: 800, defense: 800 },
  ];
}

function createRestoredBattleDestroyedScenario(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 98719226, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [alienWarriorCode] }, 1: { main: [alienAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, alienWarriorCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, alienAttackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerAlienWarrior(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStatScenario(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 98719227, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [alienWarriorCode, alienTargetCode] }, 1: { main: [alienAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, alienWarriorCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, alienTargetCode), 0, 1);
  const attacker = moveFaceUpAttack(session, requireCard(session, alienAttackerCode), 1, 0);
  expect(addDuelCardCounter(attacker, counterA, 2)).toBe(true);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerAlienWarrior(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerAlienWarrior(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(alienWarriorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Alien Warrior");
  expect(script).toContain("s.counter_place_list={COUNTER_A}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
  expect(script).toContain("local tc=e:GetHandler():GetReasonCard()");
  expect(script).toContain("tc:AddCounter(COUNTER_A,2)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
  expect(script).toContain("c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
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

function effectSummary(effect: { sourceUid: string; code?: number; event?: string; category?: number; range?: string[]; targetRange?: [number, number?]; triggerEvent?: string }) {
  return {
    category: effect.category,
    code: effect.code,
    event: effect.event,
    range: effect.range,
    sourceUid: effect.sourceUid,
    targetRange: effect.targetRange,
    triggerEvent: effect.triggerEvent,
  };
}

function attackAndReachBattleDestroyedTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  declareAttack(restored, player, attackerUid, targetUid);
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passBattleWindow(restored);
  }
}

function attackAndReachDamageCalculation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  declareAttack(restored, player, attackerUid, targetUid);
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleStep !== "damageCalculation") {
    expect(++guard).toBeLessThan(20);
    passBattleWindow(restored);
  }
  expect(restored.session.state.battleStep).toBe("damageCalculation");
}

function declareAttack(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  expectRestoredLegalActions(restored, player);
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
}

function passBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function activateTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, effectId: string): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const trigger = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "activateTrigger" && action.uid === uid && action.effectId === effectId
  );
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, trigger!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
