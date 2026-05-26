import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const alienHypnoCode = "38468214";
const targetCode = "384682140";
const decoyCode = "384682141";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlienHypnoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienHypnoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeGemini = 0x800;
const counterA = 0x100e;
const categoryControl = 0x2000;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasAlienHypnoScript)("Lua real script Alien Hypno Gemini counter control", () => {
  it("restores Gemini-status A-counter control into End Phase counter removal and self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${alienHypnoCode}.lua`);
    expect(script).toContain("--Alien Hypno");
    expect(script).toContain("Gemini.AddProcedure(c)");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCondition(Gemini.EffectStatusCondition)");
    expect(script).toContain("return c:GetCounter(COUNTER_A)>0 and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e1:SetCondition(s.ctcon)");
    expect(script).toContain("tc:RegisterEffect(e1)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("c:RemoveCounter(tp,COUNTER_A,1,REASON_EFFECT)");
    expect(script).toContain("Duel.RaiseEvent(c,EVENT_REMOVE_COUNTER+COUNTER_A,e,REASON_EFFECT,tp,tp,1)");
    expect(script).toContain("e3:SetCode(EFFECT_SELF_DESTROY)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 38468214, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alienHypnoCode] }, 1: { main: [targetCode, decoyCode] } });
    startDuel(session);

    const alienHypno = requireCard(session, alienHypnoCode);
    const target = requireCard(session, targetCode);
    const decoy = requireCard(session, decoyCode);
    moveFaceUpAttack(session, alienHypno, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    moveFaceUpAttack(session, decoy, 1, 1);
    expect(addDuelCardCounter(target, counterA, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alienHypnoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === alienHypno.uid && effect.category === categoryControl).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: categoryControl,
        code: undefined,
        event: "ignition",
        id: "lua-4",
        luaConditionDescriptor: "condition:gemini-status",
        property: 0x10,
        range: ["monsterZone"],
      },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) =>
      action.type === "activateEffect" && action.uid === alienHypno.uid && action.effectId === "lua-4"
    )).toBe(false);
    const geminiSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "normalSummon" && action.uid === alienHypno.uid
    );
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, geminiSummon!);

    const restoredGemini = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGemini);
    expectRestoredLegalActions(restoredGemini, 0);
    const control = getLuaRestoreLegalActions(restoredGemini, 0).find((action) =>
      action.type === "activateEffect" && action.uid === alienHypno.uid && action.effectId === "lua-4"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredGemini, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGemini, control!);
    resolveRestoredChain(restoredGemini);

    expect(findCard(restoredGemini.session, target.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      previousController: 1,
      reason: duelReason.effect,
      reasonCardUid: alienHypno.uid,
      reasonEffectId: 4,
      reasonPlayer: 0,
    });
    expect(findCard(restoredGemini.session, decoy.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(findCard(restoredGemini.session, alienHypno.uid).cardTargetUids).toEqual([target.uid]);
    expect(restoredGemini.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 4, controller: 1, event: "continuous", sourceUid: target.uid, triggerEvent: undefined, value: 0 },
      { code: eventPhaseEnd, controller: 1, event: "continuous", sourceUid: target.uid, triggerEvent: undefined, value: undefined },
      { code: 141, controller: 1, event: "continuous", sourceUid: target.uid, triggerEvent: undefined, value: undefined },
    ]);
    expect(restoredGemini.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
    }))).toEqual([
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: target.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: alienHypno.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previousController: 1, previousLocation: "monsterZone" },
    ]);

    const restoredControlled = restoreDuelWithLuaScripts(serializeDuel(restoredGemini.session), workspace, reader);
    expectCleanRestore(restoredControlled);
    expectRestoredLegalActions(restoredControlled, 0);
    changePhase(restoredControlled, 0, "battle");
    changePhase(restoredControlled, 0, "main2");
    changePhase(restoredControlled, 0, "end");
    expect(restoredControlled.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === target.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([]);

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredControlled.session), workspace, reader);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 0);

    expect(getDuelCardCounter(findCard(restoredEndPhase.session, target.uid), counterA)).toBe(0);
    expect(findCard(restoredEndPhase.session, target.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => ["counterRemoved", "destroyed"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
    }))).toEqual([
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: target.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.effect, eventReasonCardUid: target.uid, eventReasonEffectId: 6, eventReasonPlayer: 1, previousController: 1, previousLocation: "monsterZone" },
      { currentController: 0, currentLocation: "graveyard", eventCardUid: target.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: target.uid, eventReasonEffectId: 7, eventReasonPlayer: 1, previousController: 0, previousLocation: "monsterZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: alienHypnoCode, name: "Alien Hypno", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 4, attack: 1600, defense: 700 },
    { code: targetCode, name: "Alien Hypno A-Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    { code: decoyCode, name: "Alien Hypno Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
