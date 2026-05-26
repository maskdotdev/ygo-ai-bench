import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pumprincessCode = "17601919";
const opponentCode = "176019190";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPumprincessScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pumprincessCode}.lua`));
const counterPumpkin = 0x2f;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const effectCounterPermit = 65583;
const effectChangeType = 117;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const categoryCounter = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPumprincessScript)("Lua real script Pumprincess redirect counter stat", () => {
  it("restores destroyed monster to continuous spell redirect, standby counters, and opponent stat loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${pumprincessCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredScenario(reader, workspace, source);
    const pumprincess = requireCard(restored.session, pumprincessCode);
    const opponent = requireCard(restored.session, opponentCode);

    expectRestoredLegalActions(restored, 0);
    expect(currentAttack(opponent, restored.session.state)).toBe(1700);
    expect(currentDefense(opponent, restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === pumprincess.uid).map(effectSummary)).toEqual([
      {
        category: undefined,
        code: effectCounterPermit,
        event: "continuous",
        property: undefined,
        range: ["monsterZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: 313,
        event: "continuous",
        property: 262144,
        range: ["monsterZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: undefined,
      },
    ]);

    destroyDuelCard(restored.session.state, pumprincess.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restored.session, pumprincess.uid)).toMatchObject({
      location: "spellTrapZone",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
    expect(cardTypeFlags(findCard(restored.session, pumprincess.uid), restored.session.state)).toBe(typeSpell | typeContinuous);
    expect(currentAttack(opponent, restored.session.state)).toBe(1700);
    expect(currentDefense(opponent, restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === pumprincess.uid).map(effectSummary)).toEqual([
      {
        category: undefined,
        code: effectCounterPermit,
        event: "continuous",
        property: undefined,
        range: ["monsterZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: 313,
        event: "continuous",
        property: 262144,
        range: ["monsterZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: effectChangeType,
        event: "continuous",
        property: 1024,
        range: ["spellTrapZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: undefined,
      },
      {
        category: categoryCounter,
        code: 4098,
        event: "trigger",
        property: undefined,
        range: ["spellTrapZone"],
        sourceUid: pumprincess.uid,
        targetRange: undefined,
        triggerEvent: "phaseStandby",
      },
      {
        category: undefined,
        code: effectUpdateAttack,
        event: "continuous",
        property: undefined,
        range: ["spellTrapZone"],
        sourceUid: pumprincess.uid,
        targetRange: [0, 4],
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: effectUpdateDefense,
        event: "continuous",
        property: undefined,
        range: ["spellTrapZone"],
        sourceUid: pumprincess.uid,
        targetRange: [0, 4],
        triggerEvent: undefined,
      },
    ]);

    restored.session.state.phase = "draw";
    restored.session.state.turnPlayer = 0;
    restored.session.state.waitingFor = 0;
    const redirected = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(redirected);
    expectRestoredLegalActions(redirected, 0);
    const standby = getLuaRestoreLegalActions(redirected, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(redirected, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(redirected, standby!);
    expect(redirected.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "phaseStandby",
        eventCode: 4098,
        sourceUid: pumprincess.uid,
        effectId: "lua-4-4098",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const standbyTrigger = restoreDuelWithLuaScripts(serializeDuel(redirected.session), source, reader);
    expectCleanRestore(standbyTrigger);
    activateTrigger(standbyTrigger, pumprincess.uid, "lua-4-4098");
    passRestoredChain(standbyTrigger);
    expect(getDuelCardCounter(findCard(standbyTrigger.session, pumprincess.uid), counterPumpkin)).toBe(1);
    expect(currentAttack(findCard(standbyTrigger.session, opponent.uid), standbyTrigger.session.state)).toBe(1600);
    expect(currentDefense(findCard(standbyTrigger.session, opponent.uid), standbyTrigger.session.state)).toBe(1100);
    expect(standbyTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "counterAdded"].includes(event.eventName)).map(eventSummaryFromHistory)).toEqual([
      { eventCardUid: undefined, eventCode: 4098, eventName: "phaseStandby", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined },
      { eventCardUid: pumprincess.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: pumprincess.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(standbyTrigger.session), source, reader);
    expectCleanRestore(finalRestore);
    expectRestoredLegalActions(finalRestore, 0);
    expect(getDuelCardCounter(findCard(finalRestore.session, pumprincess.uid), counterPumpkin)).toBe(1);
    expect(cardTypeFlags(findCard(finalRestore.session, pumprincess.uid), finalRestore.session.state)).toBe(typeSpell | typeContinuous);
    expect(currentAttack(findCard(finalRestore.session, opponent.uid), finalRestore.session.state)).toBe(1600);
    expect(currentDefense(findCard(finalRestore.session, opponent.uid), finalRestore.session.state)).toBe(1100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableCounterPermit(0x2f,LOCATION_SZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_TO_GRAVE_REDIRECT_CB)");
  expect(script).toContain("return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:IsReason(REASON_DESTROY)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_TYPE)");
  expect(script).toContain("e1:SetValue(TYPE_SPELL+TYPE_CONTINUOUS)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x2f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x2f,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x2f)*-100");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pumprincessCode),
    { code: opponentCode, name: "Pumprincess Fixture Opponent", kind: "monster", attack: 1700, defense: 1200 },
  ];
}

function createRestoredScenario(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: ReturnType<typeof fixtureSource>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17601919, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pumprincessCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, pumprincessCode), 0);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pumprincessCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restored);
  return restored;
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      return workspace.readScript(name);
    },
  };
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function effectSummary(effect: { sourceUid: string; code?: number; event?: string; property?: number; category?: number; range?: string[]; targetRange?: [number, number?]; triggerEvent?: string }) {
  return {
    category: effect.category,
    code: effect.code,
    event: effect.event,
    property: effect.property,
    range: effect.range,
    sourceUid: effect.sourceUid,
    targetRange: effect.targetRange,
    triggerEvent: effect.triggerEvent,
  };
}

function eventSummaryFromHistory(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCardUid: event.eventCardUid,
    eventCode: event.eventCode,
    eventName: event.eventName,
    eventReason: event.eventReason,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventReasonPlayer: event.eventReasonPlayer,
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
