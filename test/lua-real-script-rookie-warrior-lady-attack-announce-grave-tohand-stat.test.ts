import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rookieCode = "86028783";
const warriorAttackerCode = "860287830";
const attackTargetCode = "860287831";
const recoverTargetCode = "860287832";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRookieScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rookieCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasRookieScript)("Lua real script Rookie Warrior Lady attack announce grave to-hand stat", () => {
  it("restores attack-announcement self-to-Grave ATK drop and grave self-banish Warrior recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectRookieScriptShape(workspace.readScript(`official/c${rookieCode}.lua`));
    const reader = createCardReader(cards());

    const attackWindow = createRestoredAttack({ reader, workspace });
    expectCleanRestore(attackWindow);
    expectRestoredLegalActions(attackWindow, 0);
    const rookie = requireCard(attackWindow.session, rookieCode);
    const warrior = requireCard(attackWindow.session, warriorAttackerCode);
    const attackTarget = requireCard(attackWindow.session, attackTargetCode);
    const attack = getLuaRestoreLegalActions(attackWindow, 0).find((action) => action.type === "declareAttack" && action.attackerUid === warrior.uid && action.targetUid === attackTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(attackWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(attackWindow, attack!);
    expect(attackWindow.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1130", eventCardUid: warrior.uid, eventCode: 1130, eventName: "attackDeclared", sourceUid: rookie.uid, triggerBucket: "turnOptional" },
    ]);
    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(attackWindow.session), workspace, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const drop = getLuaRestoreLegalActions(triggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === rookie.uid && action.effectId === "lua-1-1130");
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, drop!);
    resolveRestoredChain(triggerWindow);
    expect(triggerWindow.session.state.cards.find((card) => card.uid === rookie.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rookie.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(triggerWindow.session.state.cards.find((card) => card.uid === attackTarget.uid), triggerWindow.session.state)).toBe(0);
    expect(triggerWindow.session.state.effects.filter((effect) => effect.sourceUid === attackTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: attackTarget.uid, value: -2100 },
    ]);

    const graveWindow = createRestoredGraveRecovery({ reader, workspace });
    expectCleanRestore(graveWindow);
    expectRestoredLegalActions(graveWindow, 0);
    const graveRookie = requireCard(graveWindow.session, rookieCode);
    const recoverTarget = requireCard(graveWindow.session, recoverTargetCode);
    const recover = getLuaRestoreLegalActions(graveWindow, 0).find((action) => action.type === "activateEffect" && action.uid === graveRookie.uid && action.effectId === "lua-2");
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(graveWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(graveWindow, recover!);
    resolveRestoredChain(graveWindow);
    expect(graveWindow.session.state.cards.find((card) => card.uid === graveRookie.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveRookie.uid,
      reasonEffectId: 2,
    });
    expect(graveWindow.session.state.cards.find((card) => card.uid === recoverTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveRookie.uid,
      reasonEffectId: 2,
    });
    expect(graveWindow.session.state.eventHistory.filter((event) => ["attackDeclared", "sentToGraveyard", "becameTarget", "banished", "sentToHand"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "banished", eventCardUid: graveRookie.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveRookie.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard" },
      { current: "graveyard", eventCardUid: recoverTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previous: "deck" },
      { current: "hand", eventCardUid: recoverTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: graveRookie.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard" },
    ]);
    expect(graveWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAttack({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 86028783, reader, workspace, main0: [rookieCode, warriorAttackerCode], main1: [attackTargetCode] });
  moveDuelCard(session.state, requireCard(session, rookieCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, warriorAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveRecovery({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 86028784, reader, workspace, main0: [rookieCode, recoverTargetCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, rookieCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, recoverTargetCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main0,
  main1,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rookieCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectRookieScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Rookie Warrior Lady");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local b=Duel.GetAttackTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-b:GetBaseAttack())");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: rookieCode, name: "Rookie Warrior Lady", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1000, defense: 800 },
    { code: warriorAttackerCode, name: "Rookie Warrior Lady Allied Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: attackTargetCode, name: "Rookie Warrior Lady Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2100, defense: 1000 },
    { code: recoverTargetCode, name: "Rookie Warrior Lady Recovery Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
