import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeLink } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dayBreakerCode = "91336701";
const destroyTargetCode = "913367010";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDayBreakerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dayBreakerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;
const counterSpell = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDayBreakerScript)("Lua real script Day-Breaker counter destroy stat", () => {
  it("restores Link Summon Spell Counter ATK scaling and two-counter target destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dayBreakerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredLinkSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonedDayBreaker = requireCard(restoredSummon.session, dayBreakerCode);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: summonedDayBreaker.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: summonedDayBreaker.uid, triggerBucket: "turnMandatory" },
      { effectId: "lua-5-1102", eventCardUid: summonedDayBreaker.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: summonedDayBreaker.uid, triggerBucket: "turnMandatory" },
    ]);
    const counterTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summonedDayBreaker.uid && action.effectId === "lua-3-1102"
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, counterTrigger!);
    expect(restoredSummon.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([
      { category: 0x800000, targetUids: [], count: 1, player: 0, parameter: counterSpell },
    ]);
    const linkedCounterTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summonedDayBreaker.uid && action.effectId === "lua-5-1102"
    );
    expect(linkedCounterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, linkedCounterTrigger!);
    resolveRestoredChain(restoredSummon);
    expect(getDuelCardCounter(requireCard(restoredSummon.session, dayBreakerCode), counterSpell)).toBe(2);
    expect(currentAttack(requireCard(restoredSummon.session, dayBreakerCode), restoredSummon.session.state)).toBe(2200);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonedDayBreaker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x20000, range: ["monsterZone"], sourceUid: summonedDayBreaker.uid },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const dayBreaker = requireCard(restoredDestroy.session, dayBreakerCode);
    const destroyTarget = requireCard(restoredDestroy.session, destroyTargetCode);
    expect(getDuelCardCounter(dayBreaker, counterSpell)).toBe(2);
    expect(currentAttack(dayBreaker, restoredDestroy.session.state)).toBe(2200);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === dayBreaker.uid && action.effectId === "lua-6"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, dayBreaker.uid), counterSpell)).toBe(0);
    expect(findCard(restoredDestroy.session, dayBreaker.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: dayBreaker.uid,
      reasonEffectId: 6,
    });
    expect(findCard(restoredDestroy.session, destroyTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["counterRemoved", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: dayBreaker.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: dayBreaker.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: dayBreaker.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 6 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: dayBreaker.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: dayBreaker.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dayBreaker = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dayBreakerCode);
  expect(dayBreaker).toBeDefined();
  return [
    dayBreaker!,
    { code: destroyTargetCode, name: "Day-Breaker Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
  ];
}

function createRestoredLinkSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 91336701, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [dayBreakerCode] }, 1: { main: [] } });
  startDuel(session);
  setOpenMainPhase(session);
  registerDayBreaker(session, workspace);
  const dayBreaker = requireCard(session, dayBreakerCode);
  specialSummonDuelCard(session.state, dayBreaker.uid, 0, 0, {}, luaSummonTypeLink, true, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 91336702, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [destroyTargetCode], extra: [dayBreakerCode] }, 1: { main: [] } });
  startDuel(session);
  const dayBreaker = requireCard(session, dayBreakerCode);
  moveFaceUpAttack(session, dayBreaker, 0, 0).summonType = "link";
  const destroyTarget = requireCard(session, destroyTargetCode);
  moveFaceUpAttack(session, destroyTarget, 1, 0);
  expect(addDuelCardCounter(dayBreaker, counterSpell, 2)).toBe(true);
  setOpenMainPhase(session);
  registerDayBreaker(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function setOpenMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerDayBreaker(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dayBreakerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Day-Breaker the Shining Magical Warrior");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER),2,2)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:GetCounter(COUNTER_SPELL)*300");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_SPELLCASTER) and g:IsContains(c)");
  expect(script).toContain("local lg=e:GetHandler():GetLinkedGroup()");
  expect(script).toContain("e4:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("c:IsCanRemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
  const waitingFor = restored.session.state.waitingFor;
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
