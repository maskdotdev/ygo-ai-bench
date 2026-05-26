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
const balloonCode = "39892082";
const destroyerCode = "398920820";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBalloonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${balloonCode}.lua`));
const counterBalloon = 0x29;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBalloonScript)("Lua real script Balloon Lizard counter destroy damage", () => {
  it("restores Standby Balloon Counter placement and destroyed damage from leave-field counter snapshot", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${balloonCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));

    const standbyOpen = createRestoredScenario(reader, workspace, source, "draw");
    const standbyBalloon = requireCard(standbyOpen.session, balloonCode);
    expectRestoredLegalActions(standbyOpen, 0);
    const standby = getLuaRestoreLegalActions(standbyOpen, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(standbyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(standbyOpen, standby!);
    expect(standbyOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "phaseStandby",
        eventCode: 4098,
        sourceUid: standbyBalloon.uid,
        effectId: "lua-2-4098",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const standbyTrigger = restoreDuelWithLuaScripts(serializeDuel(standbyOpen.session), source, reader);
    expectCleanRestore(standbyTrigger);
    activateTrigger(standbyTrigger, standbyBalloon.uid, "lua-2-4098");
    passRestoredChain(standbyTrigger);
    expect(getDuelCardCounter(findCard(standbyTrigger.session, standbyBalloon.uid), counterBalloon)).toBe(1);
    expect(standbyTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "counterAdded"].includes(event.eventName)).map(eventSummary)).toEqual([
      { eventCardUid: undefined, eventCode: 4098, eventName: "phaseStandby", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined },
      { eventCardUid: standbyBalloon.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: standbyBalloon.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const destroyOpen = createRestoredScenario(reader, workspace, source, "main1");
    const destroyBalloon = requireCard(destroyOpen.session, balloonCode);
    const destroyer = requireCard(destroyOpen.session, destroyerCode);
    expectRestoredLegalActions(destroyOpen, 0);
    const destroyAction = getLuaRestoreLegalActions(destroyOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyer.uid
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(destroyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(destroyOpen, destroyAction!);
    passRestoredChain(destroyOpen);
    expect(findCard(destroyOpen.session, destroyBalloon.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 5,
    });
    expect(destroyOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyBalloon.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 5,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        sourceUid: destroyBalloon.uid,
        effectId: "lua-4-1029",
        player: 0,
        triggerBucket: "turnMandatory",
      },
    ]);
    const destroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(destroyOpen.session), source, reader);
    expectCleanRestore(destroyedTrigger);
    activateTrigger(destroyedTrigger, destroyBalloon.uid, "lua-4-1029");
    passRestoredChain(destroyedTrigger);
    expect(destroyedTrigger.session.state.players[0].lifePoints).toBe(7200);
    expect(destroyedTrigger.session.state.eventHistory.filter((event) => ["destroyed", "damageDealt"].includes(event.eventName)).map(destroyDamageSummary)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyBalloon.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 5,
        eventPlayer: undefined,
        eventValue: undefined,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventCardUid: undefined,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyBalloon.uid,
        eventReasonEffectId: 4,
        eventPlayer: 0,
        eventValue: 800,
      },
    ]);
    expect(destroyedTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableCounterPermit(0x29)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x29)");
  expect(script).toContain("e:GetHandler():AddCounter(0x29,1)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD_P)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("local ct=e:GetHandler():GetCounter(0x29)");
  expect(script).toContain("e:SetLabel(ct)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("local ct=e:GetLabelObject():GetLabel()");
  expect(script).toContain("Duel.SetTargetPlayer(rp)");
  expect(script).toContain("Duel.SetTargetParam(e:GetLabel()*400)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === balloonCode),
    { code: destroyerCode, name: "Balloon Lizard Fixture Destroyer", kind: "spell", typeFlags: typeSpell },
  ];
}

function createRestoredScenario(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: ReturnType<typeof fixtureSource>,
  phase: "draw" | "main1",
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 39892082, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [balloonCode, destroyerCode] }, 1: { main: [] } });
  startDuel(session);
  const balloon = requireCard(session, balloonCode);
  moveFaceUpAttack(session, balloon, 0);
  if (phase === "main1") {
    balloon.counters = { [counterBalloon]: 2 };
    moveDuelCard(session.state, requireCard(session, destroyerCode).uid, "hand", 0);
  }
  session.state.phase = phase;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(balloonCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restored);
  return restored;
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${balloonCode})
      Duel.Destroy(g,REASON_EFFECT)
    end
  `;
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

function destroyDamageSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId; eventPlayer?: PlayerId; eventValue?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventPlayer: event.eventPlayer,
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
