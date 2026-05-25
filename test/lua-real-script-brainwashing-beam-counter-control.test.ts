import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const beamCode = "59258334";
const opponentTargetCode = "592583340";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBeamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${beamCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceReptile = 0x80000;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const counterA = 0x100e;
const eventFreeChain = 1002;
const eventChainSolved = 1022;
const eventLeaveField = 1015;
const eventPhaseEnd = 4608;
const effectSetControl = 4;
const effectSelfDestroy = 141;
const effectFlagCardTarget = 0x10;
const effectFlagCannotDisable = 0x400;
const effectFlagSingleRange = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasBeamScript)("Lua real script Brainwashing Beam counter control", () => {
  it("restores A-Counter-gated persistent control and removes the target counter during End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${beamCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59258334, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [beamCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const beam = requireCard(session, beamCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    setTrap(session, beam);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    expect(addDuelCardCounter(opponentTarget, counterA, 2)).toBe(true);
    prepareMainPhase(session);
    registerBeam(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === beam.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventFreeChain, countLimit: undefined, event: "quick", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventChainSolved, countLimit: undefined, event: "continuous", id: `lua-2-${eventChainSolved}`, property: effectFlagCannotDisable, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSetControl, countLimit: undefined, event: "continuous", id: `lua-3-${effectSetControl}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSelfDestroy, countLimit: undefined, event: "continuous", id: `lua-4-${effectSelfDestroy}`, property: effectFlagSingleRange, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventLeaveField, countLimit: undefined, event: "continuous", id: `lua-5-${eventLeaveField}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventPhaseEnd, countLimit: 1, event: "continuous", id: `lua-6-${eventPhaseEnd}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === beam.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, beam.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      cardTargetUids: [opponentTarget.uid],
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: beam.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.find((effect) =>
      effect.sourceUid === beam.uid && effect.code === eventPhaseEnd
    )).toBeDefined();
    expect(getDuelCardCounter(findCard(restored.session, opponentTarget.uid), counterA)).toBe(2);

    changePhase(restored, 0, "battle");
    changePhase(restored, 0, "main2");
    changePhase(restored, 0, "end");

    expect(getDuelCardCounter(findCard(restored.session, opponentTarget.uid), counterA)).toBe(1);
    expect(findCard(restored.session, beam.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterRemoved").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: beam.uid, eventReasonEffectId: 6 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: beamCode, name: "Brainwashing Beam", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: opponentTargetCode, name: "Brainwashing Beam A-Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Brainwashing Beam");
  expect(script).toContain("s.counter_list={COUNTER_A}");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)>0 and c:IsControlerCanBeChanged()");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e2:SetCondition(aux.PersistentTgCon)");
  expect(script).toContain("c:SetCardTarget(tc)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_CONTROL)");
  expect(script).toContain("e4:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("e6:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("tc:RemoveCounter(tp,COUNTER_A,1,REASON_EFFECT)");
  expect(script).toContain("Duel.RaiseEvent(e:GetHandler(),EVENT_REMOVE_COUNTER+COUNTER_A,e,REASON_EFFECT,tp,tp,1)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerBeam(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(beamCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
