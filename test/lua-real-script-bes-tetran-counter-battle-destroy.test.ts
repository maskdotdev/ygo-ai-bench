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
const tetranCode = "44954628";
const tributeCode = "449546280";
const attackerCode = "449546281";
const spellTargetCode = "449546282";
const trapTargetCode = "449546283";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTetranScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tetranCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeWind = 0x8;
const besCounter = 0x1f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTetranScript)("Lua real script B.E.S. Tetran counter battle destroy", () => {
  it("restores summon counters, battle counter removal, and counter-cost Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tetranCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const tetran = requireCard(restoredSummon.session, tetranCode);
    const tribute = requireCard(restoredSummon.session, tributeCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === tetran.uid && action.tributeUids.includes(tribute.uid)
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === tetran.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, tetranCode), besCounter)).toBe(3);

    const restoredBattle = prepareBattleWithCounters(restoredCounter, reader, workspace, 3);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attacker = requireCard(restoredBattle.session, attackerCode);
    attackAndReachDamageEnd(restoredBattle, 1, attacker.uid, tetran.uid);
    expect(getDuelCardCounter(findCard(restoredBattle.session, tetran.uid), besCounter)).toBe(2);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded", "damageStepEnded", "counterRemoved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: tetran.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: tetran.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tetran.uid, eventReasonEffectId: 2 },
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: tetran.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tetran.uid, eventReasonEffectId: 4 },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyTetran = requireCard(restoredDestroy.session, tetranCode);
    const spellTarget = requireCard(restoredDestroy.session, spellTargetCode);
    const trapTarget = requireCard(restoredDestroy.session, trapTargetCode);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyTetran.uid && action.effectId === "lua-6"
    );
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, destroyTetran.uid), besCounter)).toBe(0);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, spellTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyTetran.uid,
      reasonEffectId: 6,
    });
    expect(findCard(restoredDestroy.session, trapTarget.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
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
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: destroyTetran.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyTetran.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 6 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyTetran.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 44954628, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tetranCode, tributeCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, tetranCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, tributeCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTetran(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 44954629, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tetranCode, spellTargetCode, trapTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const tetran = moveFaceUpAttack(session, requireCard(session, tetranCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, spellTargetCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, trapTargetCode), 0, 1);
  expect(addDuelCardCounter(tetran, besCounter, 1)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTetran(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function prepareBattleWithCounters(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  counters: number,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const tetran = requireCard(restored.session, tetranCode);
  tetran.position = "faceUpAttack";
  delete tetran.counters;
  delete tetran.counterBuckets;
  if (counters > 0) expect(addDuelCardCounter(tetran, besCounter, counters)).toBe(true);
  restored.session.state.turnPlayer = 1;
  restored.session.state.phase = "battle";
  restored.session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const tetran = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === tetranCode);
  expect(tetran).toBeDefined();
  return [
    tetran!,
    { code: tributeCode, name: "B.E.S. Tetran Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "B.E.S. Tetran Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 3000, defense: 1000 },
    { code: spellTargetCode, name: "B.E.S. Tetran Spell Target", kind: "spell", typeFlags: typeSpell },
    { code: trapTargetCode, name: "B.E.S. Tetran Trap Target", kind: "trap", typeFlags: typeTrap },
  ];
}

function registerTetran(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tetranCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--B.E.S. Tetran");
  expect(script).toContain("c:EnableCounterPermit(0x1f)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1f,3)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("e4:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("e5:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x1f,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1f,1,REASON_COST)");
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
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
