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
const droneCode = "4474060";
const spyralTargetCode = "44740600";
const spyralCostCode = "44740601";
const opponentOneCode = "44740602";
const opponentTwoCode = "44740603";
const opponentDeckOneCode = "44740604";
const opponentDeckTwoCode = "44740605";
const opponentDeckThreeCode = "44740606";
const superAgentCode = "41091257";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDroneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${droneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x2000;
const attributeWind = 0x10;
const setSpyral = 0xee;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasDroneScript)("Lua real script SPYRAL GEAR - Drone summon sort tribute stat banish to-hand", () => {
  it("restores summon decktop sort, SelfTribute SPYRAL ATK boost, and grave banish-cost Super Agent recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectDroneScriptShape(workspace.readScript(`official/c${droneCode}.lua`));
    const reader = createCardReader(cards());

    const summon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(summon);
    expectRestoredLegalActions(summon, 0);
    const summonDrone = requireCard(summon.session, droneCode);
    const normal = getLuaRestoreLegalActions(summon, 0).find((action) => action.type === "normalSummon" && action.uid === summonDrone.uid);
    expect(normal, JSON.stringify(getLuaRestoreLegalActions(summon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon, normal!);
    const summonTrigger = getLuaRestoreLegalActions(summon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summonDrone.uid && action.effectId === "lua-1-1100"
    );
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(summon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon, summonTrigger!);
    resolveRestoredChain(summon);
    expect(summon.session.state.eventHistory.filter((event) =>
      ["normalSummoned", "chainSolved"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: summonDrone.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);
    expect(summon.session.state.cards.filter((card) => card.controller === 1 && card.location === "deck").map((card) => card.code).slice(0, 3)).toEqual([
      opponentDeckOneCode,
      opponentDeckTwoCode,
      opponentDeckThreeCode,
    ]);

    const boost = createRestoredBoostOpen({ reader, workspace });
    expectCleanRestore(boost);
    expectRestoredLegalActions(boost, 0);
    const boostDrone = requireCard(boost.session, droneCode);
    const target = requireCard(boost.session, spyralTargetCode);
    const quick = getLuaRestoreLegalActions(boost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boostDrone.uid && action.effectId === "lua-3-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(boost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost, quick!);
    resolveRestoredChain(boost);
    expect(boost.session.state.cards.find((card) => card.uid === boostDrone.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: boostDrone.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(boost.session.state.cards.find((card) => card.uid === target.uid), boost.session.state)).toBe(2600);
    expect(boost.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1000 },
    ]);
    expect(boost.session.state.eventHistory.filter((event) =>
      ["becameTarget", "released"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: boostDrone.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: boostDrone.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const recovery = createRestoredRecoveryOpen({ reader, workspace });
    expectCleanRestore(recovery);
    expectRestoredLegalActions(recovery, 0);
    const graveDrone = requireCard(recovery.session, droneCode);
    const cost = requireCard(recovery.session, spyralCostCode);
    const superAgent = requireCard(recovery.session, superAgentCode);
    const recover = getLuaRestoreLegalActions(recovery, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveDrone.uid && action.effectId === "lua-4"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(recovery, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(recovery, recover!);
    resolveRestoredChain(recovery);
    expect(recovery.session.state.cards.find((card) => card.uid === graveDrone.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveDrone.uid,
      reasonEffectId: 4,
    });
    expect(recovery.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveDrone.uid,
      reasonEffectId: 4,
    });
    expect(recovery.session.state.cards.find((card) => card.uid === superAgent.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveDrone.uid,
      reasonEffectId: 4,
    });
    expect(recovery.session.state.eventHistory.filter((event) =>
      ["banished", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: cost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveDrone.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: graveDrone.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveDrone.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: cost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveDrone.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: superAgent.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 4 },
      { eventCardUid: superAgent.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: graveDrone.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(recovery.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 4474060, reader, workspace, main: [droneCode], opponent: [opponentDeckOneCode, opponentDeckTwoCode, opponentDeckThreeCode] });
  moveDuelCard(session.state, requireCard(session, droneCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBoostOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 4474061, reader, workspace, main: [droneCode, spyralTargetCode], opponent: [opponentOneCode, opponentTwoCode] });
  moveFaceUpAttack(session, requireCard(session, droneCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, spyralTargetCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentOneCode), 1, 0);
  moveFaceUpSpellTrap(session, requireCard(session, opponentTwoCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredRecoveryOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 4474062, reader, workspace, main: [droneCode, spyralCostCode, superAgentCode], opponent: [] });
  moveFaceUpGrave(session, requireCard(session, droneCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, spyralCostCode), 0, 1);
  moveFaceUpGrave(session, requireCard(session, superAgentCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main,
  opponent,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main: string[];
  opponent: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: opponent } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(droneCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: droneCode, name: "SPYRAL GEAR - Drone", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 1, attack: 100, defense: 100, setcodes: [setSpyral] },
    { code: spyralTargetCode, name: "SPYRAL Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1600, defense: 1000, setcodes: [setSpyral] },
    { code: spyralCostCode, name: "SPYRAL Banish Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1500, defense: 1000, setcodes: [setSpyral] },
    { code: superAgentCode, name: "SPYRAL Super Agent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1900, defense: 1200, setcodes: [setSpyral] },
    { code: opponentOneCode, name: "Drone Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTwoCode, name: "Drone Opponent Backrow", kind: "spell", typeFlags: 0x2 },
    { code: opponentDeckOneCode, name: "Drone Opponent Deck One", kind: "monster", typeFlags: typeMonster, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: opponentDeckTwoCode, name: "Drone Opponent Deck Two", kind: "monster", typeFlags: typeMonster, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: opponentDeckThreeCode, name: "Drone Opponent Deck Three", kind: "monster", typeFlags: typeMonster, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectDroneScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("SPYRAL GEAR - Drone");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SortDecktop(tp,1-tp,3)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)*500");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("aux.bfgcost(e,tp,eg,ep,ev,re,r,rp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,c,tp)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => (candidate as { type: string }).type === "resolveChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    guard += 1;
    expect(guard).toBeLessThan(10);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}
