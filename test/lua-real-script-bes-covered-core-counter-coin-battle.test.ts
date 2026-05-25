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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const coveredCoreCode = "15317640";
const attackerCode = "153176400";
const hasCoveredCoreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${coveredCoreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const besCounter = 0x1f;
const categoryCounter = 0x800000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasCoveredCoreScript)("Lua real script B.E.S. Covered Core counter coin battle", () => {
  it("restores summon counters, battle indestructibility, and damage-step-end coin counter removal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${coveredCoreCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummoned = summonCoveredCoreWithCounters({ reader, workspace });
    const coveredCore = requireCard(restoredSummoned.session, coveredCoreCode);
    expect(getDuelCardCounter(coveredCore, besCounter)).toBe(2);
    expect(restoredSummoned.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === coveredCore.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: coveredCore.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coveredCore.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredSummoned.session.state.effects.find((effect) => effect.sourceUid === coveredCore.uid && effect.code === 0x10000 + besCounter)).toMatchObject({
      code: 0x10000 + besCounter,
      event: "continuous",
      range: ["monsterZone"],
      value: 4,
    });
    expect(restoredSummoned.session.state.effects.filter((effect) => effect.sourceUid === coveredCore.uid && effect.code !== 0x10000 + besCounter).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: categoryCounter, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned", value: undefined },
      { category: undefined, code: 42, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: categoryCoin, code: 1141, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded", value: undefined },
      { category: 0x1, code: 1141, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded", value: undefined },
    ]);

    const restoredBattle = prepareBattle(restoredSummoned, reader, workspace);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attacker = requireCard(restoredBattle.session, attackerCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === coveredCore.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleUntilPendingTrigger(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === coveredCore.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredBattle.session.state.pendingTriggers.map(({ id: _id, eventPreviousState: _previous, eventCurrentState: _current, ...trigger }) => trigger)).toEqual([
      {
        effectId: "lua-4-1141",
        sourceUid: coveredCore.uid,
        player: 0,
        triggerBucket: "opponentMandatory",
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: coveredCore.uid,
        eventPlayer: 0,
        eventUids: [attacker.uid, coveredCore.uid],
        eventReason: 0x10,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === coveredCore.uid && action.effectId === "lua-4-1141");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([0]);
    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === coveredCore.uid), besCounter)).toBe(1);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "counterRemoved")).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coveredCore.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: coveredCore.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coveredCore.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function summonCoveredCoreWithCounters({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [coveredCoreCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, coveredCoreCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerCoveredCore(session, workspace);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const coveredCore = requireCard(restoredOpen.session, coveredCoreCode);
  const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === coveredCore.uid);
  expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, summon!);

  const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredSummonTrigger);
  expectRestoredLegalActions(restoredSummonTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === coveredCore.uid && action.effectId?.endsWith("-1100"));
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredSummonTrigger, trigger!);
  passRestoredChain(restoredSummonTrigger);
  return restoredSummonTrigger;
}

function prepareBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>, reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const attacker = requireCard(restored.session, attackerCode);
  moveFaceUpAttack(restored.session, attacker, 1, 0);
  restored.session.state.turnPlayer = 1;
  restored.session.state.phase = "battle";
  restored.session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
}

function registerCoveredCore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(coveredCoreCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--B.E.S. Covered Core");
  expect(script).toContain("c:EnableCounterPermit(0x1f)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,2,0,0x1f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1f,2)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetValue(1)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("e:GetHandler():GetCounter(0x1f)~=0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("if not Duel.CallCoin(tp) then");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("e4:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x1f)==0");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: coveredCoreCode, name: "B.E.S. Covered Core", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 800 },
    { code: attackerCode, name: "Covered Core Battle Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
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

function passRestoredBattleUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
