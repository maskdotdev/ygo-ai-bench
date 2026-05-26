import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const turnTrooperCode = "220414";
const ownMonsterCode = "990220414";
const attackerCode = "990220415";
const defenderCode = "990220416";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTurnTrooperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${turnTrooperCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterTurn = 0x14a;
const categoryCounter = 0x800000;
const categoryRemove = 0x100000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTurnTrooperScript)("Lua real script Performapal Turn Trooper counter remove", () => {
  it("restores battle-start counters, one-counter attack negation, and two-counter self-tribute temporary banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${turnTrooperCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBattleStart = createRestoredBattleStartState(reader, workspace);
    expectCleanRestore(restoredBattleStart);
    expectRestoredLegalActions(restoredBattleStart, 0);
    const battle = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleStart, battle!);
    const turnTrooper = requireCard(restoredBattleStart.session, turnTrooperCode);
    const counterTrigger = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === turnTrooper.uid && action.effectId === "lua-3-4104"
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleStart, counterTrigger!);
    resolveRestoredChain(restoredBattleStart);
    expect(getDuelCardCounter(findCard(restoredBattleStart.session, turnTrooper.uid), counterTurn)).toBe(1);
    expect(restoredBattleStart.session.state.eventHistory.filter((event) => ["phaseBattle", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "phaseBattle", eventCode: 0x1008, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: turnTrooper.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: turnTrooper.uid, eventReasonEffectId: 3 },
    ]);

    const restoredNegate = createRestoredNegateState(reader, workspace);
    expectCleanRestore(restoredNegate);
    expectRestoredLegalActions(restoredNegate, 1);
    const attacker = requireCard(restoredNegate.session, attackerCode);
    const negateTrooper = requireCard(restoredNegate.session, turnTrooperCode);
    const defender = requireCard(restoredNegate.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredNegate, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredNegate, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegate, attack!);
    expect(restoredNegate.session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: defender.uid });
    const negate = getLuaRestoreLegalActions(restoredNegate, 0).find((action) => action.type === "activateTrigger" && action.uid === negateTrooper.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredNegate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegate, negate!);
    resolveRestoredChain(restoredNegate);
    expect(restoredNegate.session.state.pendingBattle).toBeUndefined();
    expect(restoredNegate.session.state.attackCanceledUids).toEqual([attacker.uid]);
    expect(restoredNegate.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "attackDisabled", eventCode: 1142, eventCardUid: attacker.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: negateTrooper.uid, eventReasonEffectId: 4 },
    ]);

    const restoredRemove = createRestoredRemoveState(reader, workspace);
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const removeTrooper = requireCard(restoredRemove.session, turnTrooperCode);
    const ownMonster = requireCard(restoredRemove.session, ownMonsterCode);
    const opponentMonster = requireCard(restoredRemove.session, attackerCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find((action) => action.type === "activateEffect" && action.uid === removeTrooper.uid);
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    expect(findCard(restoredRemove.session, removeTrooper.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: removeTrooper.uid,
      reasonEffectId: 5,
    });
    resolveRestoredChain(restoredRemove);
    for (const card of [ownMonster, opponentMonster]) {
      expect(findCard(restoredRemove.session, card.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: removeTrooper.uid,
        reasonEffectId: 5,
      });
    }
    expect(restoredRemove.session.state.eventHistory.filter((event) => ["released", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: removeTrooper.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: removeTrooper.uid, eventReasonEffectId: 5, eventUids: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeTrooper.uid, eventReasonEffectId: 5, eventUids: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeTrooper.uid, eventReasonEffectId: 5, eventUids: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeTrooper.uid, eventReasonEffectId: 5, eventUids: [ownMonster.uid, opponentMonster.uid] },
    ]);
  });
});

function createRestoredBattleStartState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 220414, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [turnTrooperCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, turnTrooperCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTurnTrooper(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredNegateState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 220415, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [turnTrooperCode, defenderCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  const turnTrooper = moveFaceUpAttack(session, requireCard(session, turnTrooperCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  expect(addDuelCardCounter(turnTrooper, counterTurn, 1)).toBe(true);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerTurnTrooper(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredRemoveState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 220416, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [turnTrooperCode, ownMonsterCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  const turnTrooper = moveFaceUpAttack(session, requireCard(session, turnTrooperCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownMonsterCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  expect(addDuelCardCounter(turnTrooper, counterTurn, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTurnTrooper(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const turnTrooper = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === turnTrooperCode);
  expect(turnTrooper).toBeDefined();
  return [
    turnTrooper!,
    { code: ownMonsterCode, name: "Turn Trooper Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
    { code: attackerCode, name: "Turn Trooper Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: defenderCode, name: "Turn Trooper Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function registerTurnTrooper(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(turnTrooperCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Turn Trooper");
  expect(script).toContain("c:EnableCounterPermit(0x14a)");
  expect(script).toContain("c:SetCounterLimit(0x14a,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp) and e:GetHandler():GetCounter(0x14a)<2");
  expect(script).toContain("c:AddCounter(0x14a,1)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp) and e:GetHandler():GetCounter(0x14a)==1");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("e3:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x14a)==2");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,tp,LOCATION_MZONE)");
  expect(script).toContain("aux.RemoveUntil(g,nil,REASON_EFFECT,PHASE_END,id,e,tp,aux.DefaultFieldReturnOp");
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
