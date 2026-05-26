import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const breakerCode = "22923081";
const tributeCode = "229230812";
const spellTargetCode = "229230810";
const trapTargetCode = "229230811";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBreakerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${breakerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const counterSpell = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBreakerScript)("Lua real script Breaker Dark Magical Warrior counter destroy", () => {
  it("restores labeled summon Spell Counters, stat gain, and counter-cost Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${breakerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const breaker = requireCard(restoredSummon.session, breakerCode);
    const tribute = requireCard(restoredSummon.session, tributeCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === breaker.uid && action.tributeUids.includes(tribute.uid)
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    expect(findCard(restoredSummon.session, tribute.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
      reasonCardUid: breaker.uid,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const triggerBreaker = requireCard(restoredTrigger.session, breakerCode);
    const counterTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === triggerBreaker.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, counterTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(requireCard(restoredTrigger.session, breakerCode), counterSpell)).toBe(2);
    expect(currentAttack(requireCard(restoredTrigger.session, breakerCode), restoredTrigger.session.state)).toBe(2400);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: breaker.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: breaker.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: breaker.uid, eventReasonEffectId: 2 },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyBreaker = requireCard(restoredDestroy.session, breakerCode);
    const spellTarget = requireCard(restoredDestroy.session, spellTargetCode);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyBreaker.uid && action.effectId === "lua-5"
    );
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, destroyBreaker.uid), counterSpell)).toBe(0);
    expect(currentAttack(findCard(restoredDestroy.session, destroyBreaker.uid), restoredDestroy.session.state)).toBe(1600);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, spellTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyBreaker.uid,
      reasonEffectId: 5,
    });
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
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: destroyBreaker.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyBreaker.uid, eventReasonEffectId: 5, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 5 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyBreaker.uid, eventReasonEffectId: 5, relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const breaker = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === breakerCode);
  expect(breaker).toBeDefined();
  return [
    breaker!,
    { code: tributeCode, name: "Dark Breaker Tribute", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: spellTargetCode, name: "Dark Breaker Spell Target", kind: "spell", typeFlags: typeSpell },
    { code: trapTargetCode, name: "Dark Breaker Trap Target", kind: "trap", typeFlags: typeTrap },
  ];
}

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 22923081, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [breakerCode, tributeCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, breakerCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, tributeCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBreaker(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 22923082, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [breakerCode, spellTargetCode, trapTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const breaker = moveFaceUpAttack(session, requireCard(session, breakerCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, spellTargetCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, trapTargetCode), 0, 1);
  expect(addDuelCardCounter(breaker, counterSpell, 1)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBreaker(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerBreaker(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(breakerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Breaker the Dark Magical Warrior");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e1:SetLabel(2)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsPendulumSummoned()");
  expect(script).toContain("e2:SetLabel(3)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),0,COUNTER_SPELL)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,e:GetLabel())");
  expect(script).toContain("return c:GetCounter(COUNTER_SPELL)*400");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
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
