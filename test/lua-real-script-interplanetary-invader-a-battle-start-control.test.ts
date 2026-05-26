import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const invaderCode = "14729426";
const attackerCode = "147294260";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasInvaderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${invaderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const eventBattleStart = 1132;
const eventPhaseBattle = 0x1080;

describe.skipIf(!hasUpstreamScripts || !hasInvaderScript)("Lua real script Interplanetary Invader A battle-start control", () => {
  it("restores battle-start registered Battle Phase control of the attacker", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${invaderCode}.lua`);
    expect(script).toContain('--Interplanetary Invader "A"');
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("e:GetHandler()==Duel.GetAttackTarget()");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE)");
    expect(script).toContain("e1:SetTarget(s.cttg)");
    expect(script).toContain("e1:SetOperation(s.ctop)");
    expect(script).toContain("e1:SetLabelObject(a)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("Duel.SetTargetCard(a)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 14729426, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [invaderCode] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const invader = requireCard(session, invaderCode);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, invader, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(invaderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === invader.uid && effect.registryKey?.startsWith("lua:")).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { code: eventBattleStart, event: "continuous", id: `lua-1-${eventBattleStart}`, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === invader.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passAttackResponsesUntil(restoredBattle, () =>
      restoredBattle.session.state.effects.some((effect) => effect.sourceUid === invader.uid && effect.registryKey?.startsWith("lua:") && effect.code === eventPhaseBattle)
    );
    openBattlePhaseEndWindow(restoredBattle.session);

    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === invader.uid && effect.registryKey?.startsWith("lua:")).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventBattleStart, countLimit: undefined, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleStarted" },
      { category: categoryControl, code: eventPhaseBattle, countLimit: 1, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "phaseBattle" },
    ]);

    const restoredRegistered = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredRegistered);
    passBattleResponsesUntil(restoredRegistered, 0, "main2");
    expectRestoredLegalActions(restoredRegistered, 0);
    changePhase(restoredRegistered, 0, "main2");
    expect(restoredRegistered.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === invader.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventUids: trigger.eventUids,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: `lua-2-${eventPhaseBattle}`, eventCode: eventPhaseBattle, eventName: "phaseBattle", eventUids: undefined, player: 1, triggerBucket: "opponentMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredRegistered.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 1);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === invader.uid && action.effectId === `lua-2-${eventPhaseBattle}`
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, attacker.uid)).toMatchObject({
      controller: 1,
      location: "monsterZone",
      previousController: 0,
      reason: duelReason.effect,
      reasonCardUid: invader.uid,
      reasonEffectId: 2,
      reasonPlayer: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleStarted", "phaseBattle", "controlChanged"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
    }))).toEqual([
      { currentController: 0, eventCardUid: attacker.uid, eventCode: eventBattleStart, eventName: "battleStarted", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previousController: 0 },
      { currentController: undefined, eventCardUid: undefined, eventCode: eventPhaseBattle, eventName: "phaseBattle", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined, previousController: undefined },
      { currentController: 1, eventCardUid: attacker.uid, eventCode: 1120, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: invader.uid, eventReasonEffectId: 2, eventReasonPlayer: 1, previousController: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: invaderCode, name: 'Interplanetary Invader "A"', kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 500 },
    { code: attackerCode, name: "Interplanetary Invader A Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function openBattlePhaseEndWindow(session: DuelSession): void {
  delete session.state.currentAttack;
  delete session.state.pendingBattle;
  delete session.state.battleWindow;
  delete session.state.battleStep;
  session.state.attackPasses = [];
  session.state.damagePasses = [];
  session.state.waitingFor = session.state.turnPlayer;
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

function passAttackResponsesUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function passBattleResponsesUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "changePhase" && action.phase === phase)) {
    expect(++guard).toBeLessThan(30);
    const currentPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, currentPlayer).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, currentPlayer), null, 2)).toBeDefined();
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
