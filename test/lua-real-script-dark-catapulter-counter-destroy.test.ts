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
const catapulterCode = "33875961";
const graveCostACode = "338759610";
const graveCostBCode = "338759611";
const spellTargetCode = "338759612";
const trapTargetCode = "338759613";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCatapulterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${catapulterCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeDark = 0x1;
const counterCatapult = 0x28;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCatapulterScript)("Lua real script Dark Catapulter counter destroy", () => {
  it("restores self Standby counter placement and counter-count grave banish cost into Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${catapulterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredStandbyOpen = createRestoredStandbyState(reader, workspace);
    expectCleanRestore(restoredStandbyOpen);
    expectRestoredLegalActions(restoredStandbyOpen, 0);
    const standby = getLuaRestoreLegalActions(restoredStandbyOpen, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredStandbyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandbyOpen, standby!);
    const catapulter = requireCard(restoredStandbyOpen.session, catapulterCode);
    expect(restoredStandbyOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-4098", eventCode: 0x1002, eventName: "phaseStandby", player: 0, sourceUid: catapulter.uid, triggerBucket: "turnMandatory" },
    ]);
    const restoredStandbyTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredStandbyOpen.session), workspace, reader);
    expectCleanRestore(restoredStandbyTrigger);
    expectRestoredLegalActions(restoredStandbyTrigger, 0);
    const standbyTrigger = getLuaRestoreLegalActions(restoredStandbyTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === catapulter.uid && action.effectId === "lua-2-4098"
    );
    expect(standbyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStandbyTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandbyTrigger, standbyTrigger!);
    expect(restoredStandbyTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredStandbyTrigger);
    expect(getDuelCardCounter(requireCard(restoredStandbyTrigger.session, catapulterCode), counterCatapult)).toBe(1);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyCatapulter = requireCard(restoredDestroy.session, catapulterCode);
    const graveCostA = requireCard(restoredDestroy.session, graveCostACode);
    const graveCostB = requireCard(restoredDestroy.session, graveCostBCode);
    const spellTarget = requireCard(restoredDestroy.session, spellTargetCode);
    const trapTarget = requireCard(restoredDestroy.session, trapTargetCode);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyCatapulter.uid && action.effectId === "lua-3"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, destroyCatapulter.uid), counterCatapult)).toBe(0);
    for (const cost of [graveCostA, graveCostB]) {
      expect(findCard(restoredDestroy.session, cost.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: destroyCatapulter.uid,
        reasonEffectId: 3,
      });
    }
    for (const target of [spellTarget, trapTarget]) {
      expect(findCard(restoredDestroy.session, target.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: destroyCatapulter.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "destroyed", "counterRemoved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveCostA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveCostB.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveCostA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: trapTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: trapTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: destroyCatapulter.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destroyCatapulter.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const catapulter = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === catapulterCode);
  expect(catapulter).toBeDefined();
  return [
    catapulter!,
    { code: graveCostACode, name: "Dark Catapulter Grave Cost A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: graveCostBCode, name: "Dark Catapulter Grave Cost B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: spellTargetCode, name: "Dark Catapulter Spell Target", kind: "spell", typeFlags: typeSpell },
    { code: trapTargetCode, name: "Dark Catapulter Trap Target", kind: "trap", typeFlags: typeTrap },
  ];
}

function createRestoredStandbyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33875961, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [catapulterCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpDefense(session, requireCard(session, catapulterCode), 0, 0);
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "draw";
  session.state.waitingFor = 0;
  registerCatapulter(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33875962, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [catapulterCode, graveCostACode, graveCostBCode, spellTargetCode, trapTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const catapulter = moveFaceUpDefense(session, requireCard(session, catapulterCode), 0, 0);
  expect(addDuelCardCounter(catapulter, counterCatapult, 2)).toBe(true);
  moveDuelCard(session.state, requireCard(session, graveCostACode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveCostBCode).uid, "graveyard", 0);
  moveFaceUpSpellTrap(session, requireCard(session, spellTargetCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, trapTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerCatapulter(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerCatapulter(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(catapulterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Catapulter");
  expect(script).toContain("c:EnableCounterPermit(0x28)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp) and e:GetHandler():IsDefensePos()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x28)");
  expect(script).toContain("e:GetHandler():AddCounter(0x28,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToRemove,tp,LOCATION_GRAVE,0,ct,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,LOCATION_GRAVE,0,ct,ct,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("return c:IsSpellTrap()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,ct,ct,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,ct,0,0)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x28,ct,REASON_EFFECT)");
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

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
