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
const mushroomCode = "93900406";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMushroomScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mushroomCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const attributeEarth = 0x1;
const categoryDamage = 0x80000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasMushroomScript)("Lua real script Mushroom Man 2 standby end control", () => {
  it("restores turn-player Standby damage and LP-cost End Phase control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mushroomCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const standbyOpen = createRestoredMushroomPhase({ reader, workspace, phase: "draw", turnPlayer: 0 });
    const standbyMushroom = requireCard(standbyOpen.session, mushroomCode);
    expectCleanRestore(standbyOpen);
    expectRestoredLegalActions(standbyOpen, 0);
    expect(standbyOpen.session.state.effects.filter((effect) => effect.sourceUid === standbyMushroom.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryDamage, code: 4098, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseStandby" },
      { category: categoryControl, code: 4608, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseEnd" },
    ]);
    const standby = getLuaRestoreLegalActions(standbyOpen, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(standbyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(standbyOpen, standby!);
    expect(standbyOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-1-4098",
        sourceUid: standbyMushroom.uid,
        eventName: "phaseStandby",
        eventCode: 4098,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const standbyTrigger = restoreDuelWithLuaScripts(serializeDuel(standbyOpen.session), workspace, reader);
    expectCleanRestore(standbyTrigger);
    expectRestoredLegalActions(standbyTrigger, 0);
    activateTrigger(standbyTrigger, standbyMushroom.uid, "lua-1-4098");
    passRestoredChain(standbyTrigger);
    expect(standbyTrigger.session.state.players[0].lifePoints).toBe(7700);
    expect(standbyTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "damageDealt"].includes(event.eventName))).toEqual([
      { eventName: "phaseStandby", eventCode: 4098 },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: standbyMushroom.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const endOpen = createRestoredMushroomPhase({ reader, workspace, phase: "main2", turnPlayer: 0 });
    const endMushroom = requireCard(endOpen.session, mushroomCode);
    expectCleanRestore(endOpen);
    expectRestoredLegalActions(endOpen, 0);
    const end = getLuaRestoreLegalActions(endOpen, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(endOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(endOpen, end!);
    expect(endOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-2-4608",
        sourceUid: endMushroom.uid,
        eventName: "phaseEnd",
        eventCode: 4608,
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);

    const controlTrigger = restoreDuelWithLuaScripts(serializeDuel(endOpen.session), workspace, reader);
    expectCleanRestore(controlTrigger);
    expectRestoredLegalActions(controlTrigger, 0);
    activateTrigger(controlTrigger, endMushroom.uid, "lua-2-4608");
    passRestoredChain(controlTrigger);
    expect(controlTrigger.session.state.players[0].lifePoints).toBe(7500);
    expect(controlTrigger.session.state.cards.find((card) => card.uid === endMushroom.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: endMushroom.uid,
      reasonEffectId: 2,
    });
    expect(controlTrigger.session.state.eventHistory.filter((event) => ["phaseEnd", "lifePointCostPaid", "controlChanged"].includes(event.eventName))).toEqual([
      { eventName: "phaseEnd", eventCode: 4608 },
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: endMushroom.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: endMushroom.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: endMushroom.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(controlTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mushroom Man #2");
  expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,0,0,tp,300)");
  expect(script).toContain("Duel.Damage(tp,300,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(500))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: mushroomCode, name: "Mushroom Man #2", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 3, attack: 1250, defense: 800 },
  ];
}

function createRestoredMushroomPhase({
  reader,
  workspace,
  phase,
  turnPlayer,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  phase: DuelSession["state"]["phase"];
  turnPlayer: PlayerId;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 93900406, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [mushroomCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, mushroomCode), 0, 0);
  session.state.turn = 2;
  session.state.phase = phase;
  session.state.turnPlayer = turnPlayer;
  session.state.waitingFor = turnPlayer;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(mushroomCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
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
