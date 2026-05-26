import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const daredevilCode = "98162021";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDaredevilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${daredevilCode}.lua`));
const counterBushido = 0x3;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasDaredevilScript)("Lua real script Shien's Daredevil counter transfer stat", () => {
  it("restores summon Bushido Counter placement and targeted counter transfer ATK updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${daredevilCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredScenario(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const [summoned, target] = daredevils(restoredOpen.session);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summoned.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        sourceUid: summoned.uid,
        effectId: "lua-3-1100",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const addCounter = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summoned.uid && action.effectId === "lua-3-1100");
    expect(addCounter, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, addCounter!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(getDuelCardCounter(findCard(restoredSummonTrigger.session, summoned.uid), counterBushido)).toBe(1);
    expect(currentAttack(findCard(restoredSummonTrigger.session, summoned.uid), restoredSummonTrigger.session.state)).toBe(1900);
    expect(currentAttack(findCard(restoredSummonTrigger.session, target.uid), restoredSummonTrigger.session.state)).toBe(1600);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: summoned.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: summoned.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summoned.uid, eventReasonEffectId: 3 },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const transfer = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === summoned.uid && action.effectId === "lua-5");
    expect(transfer, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, transfer!);
    resolveRestoredChain(restoredIgnition);

    expect(getDuelCardCounter(findCard(restoredIgnition.session, summoned.uid), counterBushido)).toBe(0);
    expect(getDuelCardCounter(findCard(restoredIgnition.session, target.uid), counterBushido)).toBe(1);
    expect(currentAttack(findCard(restoredIgnition.session, summoned.uid), restoredIgnition.session.state)).toBe(1600);
    expect(currentAttack(findCard(restoredIgnition.session, target.uid), restoredIgnition.session.state)).toBe(1900);
    expect(restoredIgnition.session.state.effects.filter((effect) => [summoned.uid, target.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 131072, range: ["monsterZone"], sourceUid: summoned.uid },
      { code: effectUpdateAttack, event: "continuous", property: 131072, range: ["monsterZone"], sourceUid: target.uid },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["counterRemoved", "becameTarget", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: summoned.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summoned.uid, eventReasonEffectId: 3 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: summoned.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summoned.uid, eventReasonEffectId: 5 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summoned.uid, eventReasonEffectId: 5 },
    ]);

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), workspace, reader);
    expectCleanRestore(finalRestore);
    expectRestoredLegalActions(finalRestore, 0);
    expect(currentAttack(findCard(finalRestore.session, target.uid), finalRestore.session.state)).toBe(1900);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const daredevil = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === daredevilCode);
  expect(daredevil).toBeDefined();
  return [daredevil!];
}

function createRestoredScenario(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 98162021, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [daredevilCode, daredevilCode] }, 1: { main: [] } });
  startDuel(session);
  const [summoned, target] = daredevils(session);
  moveDuelCard(session.state, summoned.uid, "hand", 0);
  moveFaceUpAttack(session, target, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(daredevilCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Shien's Daredevil");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_BUSHIDO)");
  expect(script).toContain("c:SetCounterLimit(COUNTER_BUSHIDO,1)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_BUSHIDO)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_BUSHIDO,1)");
  expect(script).toContain("return c:GetCounter(COUNTER_BUSHIDO)*300");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler(),COUNTER_BUSHIDO,1)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_BUSHIDO,1,REASON_EFFECT)");
  expect(script).toContain("tc:AddCounter(COUNTER_BUSHIDO,1)");
}

function daredevils(session: DuelSession): [DuelCardInstance, DuelCardInstance] {
  const cards = session.state.cards.filter((card) => card.code === daredevilCode).sort((left, right) => left.uid.localeCompare(right.uid));
  expect(cards).toHaveLength(2);
  return [cards[0]!, cards[1]!];
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

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonPlayer?: PlayerId; eventReasonCardUid?: string; eventReasonEffectId?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
