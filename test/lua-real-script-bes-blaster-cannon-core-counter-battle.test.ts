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
const blasterCode = "84257883";
const opponentACode = "842578830";
const opponentBCode = "842578831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBlasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blasterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeDark = 0x1;
const besCounter = 0x1f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBlasterScript)("Lua real script B.E.S. Blaster Cannon Core counter battle", () => {
  it("restores opponent-count hand summon, summon counters, and damage-step-end remove-or-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blasterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = setupProcedureWindow({ reader, workspace });
    const blaster = requireCard(restoredSummon.session, blasterCode);
    const procedure = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === blaster.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, procedure!);
    expect(findCard(restoredSummon.session, blaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === blaster.uid && action.effectId?.endsWith("-1102")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, blasterCode), besCounter)).toBe(3);

    const restoredRemove = prepareBattleWithCounters(restoredCounter, reader, workspace, 3);
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 1);
    const opponentA = requireCard(restoredRemove.session, opponentACode);
    attackAndReachDamageEnd(restoredRemove, 1, opponentA.uid, blaster.uid);
    expect(getDuelCardCounter(findCard(restoredRemove.session, blaster.uid), besCounter)).toBe(2);
    expect(findCard(restoredRemove.session, blaster.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredRemove.session.state.eventHistory.filter((event) => ["specialSummoned", "counterAdded", "damageStepEnded", "counterRemoved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: blaster.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: blaster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: blaster.uid, eventReasonEffectId: 4 },
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: opponentA.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: blaster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: blaster.uid, eventReasonEffectId: 6 },
    ]);

    const restoredDestroy = prepareBattleWithCounters(restoredCounter, reader, workspace, 0);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 1);
    const opponentB = requireCard(restoredDestroy.session, opponentBCode);
    attackAndReachDamageEnd(restoredDestroy, 1, opponentB.uid, blaster.uid);
    expect(findCard(restoredDestroy.session, blaster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: blaster.uid,
      reasonEffectId: 6,
    });
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["damageStepEnded", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: opponentB.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: blaster.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: blaster.uid, eventReasonEffectId: 6 },
    ]);
  });
});

function setupProcedureWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84257883, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blasterCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, blasterCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBlaster(session, workspace);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return restored;
}

function prepareBattleWithCounters(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  counters: number,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const blaster = requireCard(restored.session, blasterCode);
  blaster.position = "faceUpAttack";
  delete blaster.counters;
  delete blaster.counterBuckets;
  if (counters > 0) expect(addDuelCardCounter(blaster, besCounter, counters)).toBe(true);
  restored.session.state.turnPlayer = 1;
  restored.session.state.phase = "battle";
  restored.session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
}

function registerBlaster(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blasterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--B.E.S. Blaster Cannon Core");
  expect(script).toContain("c:EnableCounterPermit(0x1f)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0");
  expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0,nil)<Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE,nil)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1f,3)");
  expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e5:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:IsCanRemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const blaster = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === blasterCode);
  expect(blaster).toBeDefined();
  return [
    blaster!,
    { code: opponentACode, name: "Blaster Cannon Core Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 3000, defense: 1000 },
    { code: opponentBCode, name: "Blaster Cannon Core Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 3000, defense: 1000 },
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

function attackAndReachDamageEnd(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  passRestoredUntilNoPendingBattle(restored);
}

function passRestoredUntilNoPendingBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      resolveRestoredChain(restored);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
