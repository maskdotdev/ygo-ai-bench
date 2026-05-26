import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cauldronCode = "91740879";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCauldronScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cauldronCode}.lua`));
const counterCauldron = 0x14e;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCauldronScript)("Lua real script Cauldron of the Old Man counter LP", () => {
  it("restores activation and self-standby Cauldron Counters into ChainInfo recover and damage ignition branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${cauldronCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const standbyOpen = createRestoredScenario(reader, workspace, "draw");
    const standbyCauldron = requireCard(standbyOpen.session, cauldronCode);
    expectRestoredLegalActions(standbyOpen, 0);
    const standby = getLuaRestoreLegalActions(standbyOpen, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(standbyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(standbyOpen, standby!);
    expect(standbyOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "phaseStandby",
        eventCode: 4098,
        sourceUid: standbyCauldron.uid,
        effectId: "lua-3-4098",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const standbyTrigger = restoreDuelWithLuaScripts(serializeDuel(standbyOpen.session), workspace, reader);
    expectCleanRestore(standbyTrigger);
    activateTrigger(standbyTrigger, standbyCauldron.uid, "lua-3-4098");
    passRestoredChain(standbyTrigger);
    expect(getDuelCardCounter(findCard(standbyTrigger.session, standbyCauldron.uid), counterCauldron)).toBe(2);
    expect(standbyTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "counterAdded"].includes(event.eventName)).map(eventSummary)).toEqual([
      { eventCardUid: undefined, eventCode: 4098, eventName: "phaseStandby", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined },
      { eventCardUid: standbyCauldron.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: standbyCauldron.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const recover = createRestoredScenario(reader, workspace, "main1");
    const recoverCauldron = requireCard(recover.session, cauldronCode);
    expectRestoredLegalActions(recover, 0);
    const recoverAction = getLuaRestoreLegalActions(recover, 0).find((action) =>
      action.type === "activateEffect" && action.uid === recoverCauldron.uid && action.effectId === "lua-4"
    );
    expect(recoverAction, JSON.stringify(getLuaRestoreLegalActions(recover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(recover, recoverAction!);
    passRestoredChain(recover);
    expect(recover.session.state.players[0].lifePoints).toBe(9000);
    expect(recover.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints").map(lpEventSummary)).toEqual([
      { eventCode: 1112, eventName: "recoveredLifePoints", eventPlayer: 0, eventReason: duelReason.effect, eventReasonCardUid: recoverCauldron.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: 1000 },
    ]);

    const damage = createRestoredScenario(reader, workspace, "main1");
    const damageCauldron = requireCard(damage.session, cauldronCode);
    expectRestoredLegalActions(damage, 0);
    const damageAction = getLuaRestoreLegalActions(damage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === damageCauldron.uid && action.effectId === "lua-5"
    );
    expect(damageAction, JSON.stringify(getLuaRestoreLegalActions(damage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(damage, damageAction!);
    passRestoredChain(damage);
    expect(damage.session.state.players[1].lifePoints).toBe(7400);
    expect(damage.session.state.eventHistory.filter((event) => event.eventName === "damageDealt").map(lpEventSummary)).toEqual([
      { eventCode: 1111, eventName: "damageDealt", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: damageCauldron.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventValue: 600 },
    ]);
    expect(damage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("local COUNTER_CAULDRON=0x14e");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_CAULDRON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("Duel.IsCanAddCounter(tp,COUNTER_CAULDRON,1,c)");
  expect(script).toContain("c:AddCounter(COUNTER_CAULDRON,1)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e3:SetCountLimit(1,0,EFFECT_COUNT_CODE_SINGLE)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,val)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,dam)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cauldronCode);
}

function createRestoredScenario(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  phase: "draw" | "main1",
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 91740879, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cauldronCode] }, 1: { main: [] } });
  startDuel(session);
  const cauldron = requireCard(session, cauldronCode);
  moveFaceUpSpell(session, cauldron);
  cauldron.counters = { [counterCauldron]: 1 };
  if (phase === "main1") cauldron.counters = { [counterCauldron]: 2 };
  session.state.phase = phase;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cauldronCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  return restored;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
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

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
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

function lpEventSummary(event: { eventName: string; eventCode?: number; eventPlayer?: PlayerId; eventValue?: number; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCode: event.eventCode,
    eventName: event.eventName,
    eventPlayer: event.eventPlayer,
    eventReason: event.eventReason,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventReasonPlayer: event.eventReasonPlayer,
    eventValue: event.eventValue,
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
