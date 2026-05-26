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
const traineeCode = "89567993";
const targetCode = "895679930";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTraineeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${traineeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectBattleDestroyRedirect = 204;
const effectUpdateAttack = 100;
const locationDeckBottom = 65537;
const resetStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTraineeScript)("Lua real script Amazoness Trainee battle destroy redirect stat", () => {
  it("restores battle-destroy redirect to Deck bottom and battle-destroying ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${traineeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createBattleSession({ reader, workspace });
    const trainee = requireCard(session, traineeCode);
    const target = requireCard(session, targetCode);

    expect(session.state.effects.filter((effect) => effect.sourceUid === trainee.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectBattleDestroyRedirect, event: "continuous", property: 0x20000, range: ["monsterZone"], sourceUid: trainee.uid, triggerEvent: undefined, value: locationDeckBottom },
      { code: 1139, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: trainee.uid, triggerEvent: "battleDestroyed", value: undefined },
    ]);

    const attack = getLegalActions(session, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === trainee.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleUntilTrigger(session);
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
      reasonCardUid: trainee.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1139",
        eventCardUid: trainee.uid,
        eventCode: 1139,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle | duelReason.destroy | duelReason.redirect,
        eventReasonCardUid: trainee.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-6-1",
        player: 0,
        sourceUid: trainee.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === trainee.uid && action.effectId === "lua-2-1139"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, trainee.uid), restoredTrigger.session.state)).toBe(1700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === trainee.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardDisable }, sourceUid: trainee.uid, value: 200 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "battleDamageDealt"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: trainee.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 1, eventReason: duelReason.battle, eventReasonCardUid: trainee.uid, eventReasonPlayer: 0, eventValue: 500 },
      { eventCardUid: target.uid, eventCode: 1140, eventName: "battleDestroyed", eventPlayer: undefined, eventReason: duelReason.battle | duelReason.destroy | duelReason.redirect, eventReasonCardUid: trainee.uid, eventReasonPlayer: 0, eventValue: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const trainee = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === traineeCode);
  expect(trainee).toBeDefined();
  return [
    trainee!,
    { code: targetCode, name: "Amazoness Trainee Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 89567993, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [traineeCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, traineeCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(traineeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Amazoness Trainee");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)");
  expect(script).toContain("e1:SetValue(LOCATION_DECKBOT)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("return e:GetHandler():IsFaceup() and e:GetHandler():IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType || action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
