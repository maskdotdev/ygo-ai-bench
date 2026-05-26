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
const bigCoreCode = "82821760";
const opponentCode = "828217600";
const graveBesOneCode = "828217601";
const graveBesTwoCode = "828217602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBigCoreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bigCoreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const besCounter = 0x1f;
const setBes = 0x15;

describe.skipIf(!hasUpstreamScripts || !hasBigCoreScript)("Lua real script BES Big Core MK-3 counter toDeck", () => {
  it("restores hand procedure, summon counters, battle counter removal, and grave SelfBanish shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bigCoreCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = setupProcedureWindow({ reader, workspace });
    const bigCore = requireCard(restoredSummon.session, bigCoreCode);
    const procedure = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === bigCore.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, procedure!);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === bigCore.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === bigCore.uid && action.effectId?.endsWith("-1102")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, bigCoreCode), besCounter)).toBe(3);

    const battlingBigCore = requireCard(restoredCounter.session, bigCoreCode);
    battlingBigCore.position = "faceUpAttack";
    const opponent = requireCard(restoredCounter.session, opponentCode);
    moveFaceUpAttack(restoredCounter.session, opponent, 1, 0);
    restoredCounter.session.state.phase = "battle";
    restoredCounter.session.state.turnPlayer = 0;
    restoredCounter.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    attackAndReachDamageEnd(restoredBattle, 0, bigCore.uid, opponent.uid);
    expect(getDuelCardCounter(requireCard(restoredBattle.session, bigCoreCode), besCounter)).toBe(2);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === bigCore.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["specialSummoned", "counterAdded", "damageStepEnded", "counterRemoved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: bigCore.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: bigCore.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bigCore.uid, eventReasonEffectId: 4 },
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: bigCore.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: bigCore.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bigCore.uid, eventReasonEffectId: 6 },
    ]);

    const restoredToDeck = setupToDeckWindow({ reader, workspace });
    const graveBigCore = requireCard(restoredToDeck.session, bigCoreCode);
    const graveBesOne = requireCard(restoredToDeck.session, graveBesOneCode);
    const graveBesTwo = requireCard(restoredToDeck.session, graveBesTwoCode);
    const toDeck = getLuaRestoreLegalActions(restoredToDeck, 0).find((action) => action.type === "activateEffect" && action.uid === graveBigCore.uid);
    expect(toDeck, JSON.stringify(getLuaRestoreLegalActions(restoredToDeck, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredToDeck, toDeck!);
    expect(restoredToDeck.session.state.cards.find((card) => card.uid === graveBigCore.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveBigCore.uid,
      reasonEffectId: 7,
    });
    resolveRestoredChain(restoredToDeck);
    for (const shuffled of [graveBesOne, graveBesTwo]) {
      expect(restoredToDeck.session.state.cards.find((card) => card.uid === shuffled.uid)).toMatchObject({
        location: "deck",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: graveBigCore.uid,
        reasonEffectId: 7,
      });
    }
    expect(restoredToDeck.session.state.eventHistory.filter((event) => ["banished", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCardUid: graveBigCore.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveBigCore.uid, eventReasonEffectId: 7 },
      { eventName: "sentToDeck", eventCardUid: graveBesOne.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBigCore.uid, eventReasonEffectId: 7 },
      { eventName: "sentToDeck", eventCardUid: graveBesTwo.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBigCore.uid, eventReasonEffectId: 7 },
      { eventName: "sentToDeck", eventCardUid: graveBesOne.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBigCore.uid, eventReasonEffectId: 7 },
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
  const session = createDuel({ seed: 82821760, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bigCoreCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, bigCoreCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBigCore(session, workspace);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return restored;
}

function setupToDeckWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82821761, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bigCoreCode, graveBesOneCode, graveBesTwoCode] }, 1: { main: [] } });
  startDuel(session);
  for (const code of [bigCoreCode, graveBesOneCode, graveBesTwoCode]) {
    moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBigCore(session, workspace);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return restored;
}

function registerBigCore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(bigCoreCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--B.E.S. Big Core MK-3");
  expect(script).toContain("c:EnableCounterPermit(0x1f)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetTargetRange(POS_FACEUP_DEFENSE,0)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==0");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>0");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1f,3)");
  expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e5:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:IsCanRemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("e6:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsSetCard(SET_BES) and c:IsAbleToDeck()");
  expect(script).toContain("Duel.GetMatchingGroup(s.tdfilter,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: bigCoreCode, name: "B.E.S. Big Core MK-3", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2700, defense: 1900, setcodes: [setBes] },
    { code: opponentCode, name: "Big Core MK-3 Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    { code: graveBesOneCode, name: "Big Core MK-3 Grave B.E.S. One", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000, setcodes: [setBes] },
    { code: graveBesTwoCode, name: "Big Core MK-3 Grave B.E.S. Two", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000, setcodes: [setBes] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
