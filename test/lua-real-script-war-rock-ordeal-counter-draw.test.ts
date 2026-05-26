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
const ordealCode = "71331215";
const warRockCode = "713312150";
const battleTargetCode = "713312151";
const drawCardCode = "713312152";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasOrdealScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ordealCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setWarRock = 0x161;
const counterWarRock = 0x205;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasOrdealScript)("Lua real script War Rock Ordeal counter draw", () => {
  it("restores battle-destroyed counter removal into draw plus last-counter self-send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ordealCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBattle = createRestoredBattleState(reader, workspace);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const ordeal = requireCard(restoredBattle.session, ordealCode);
    const attacker = requireCard(restoredBattle.session, warRockCode);
    const target = requireCard(restoredBattle.session, battleTargetCode);
    const drawCard = requireCard(restoredBattle.session, drawCardCode);
    attackAndReachBattleDestroyedTrigger(restoredBattle, 0, attacker.uid, target.uid);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const drawTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ordeal.uid && action.effectId?.endsWith("-1140")
    );
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, drawTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, ordeal.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ordeal.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredTrigger.session, drawCard.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "counterRemoved", "cardsDrawn", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: target.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: target.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: ordeal.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ordeal.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ordeal.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ordeal.uid, eventReasonEffectId: 4 },
      { eventName: "counterRemoved", eventCode: 0x20205, eventCardUid: ordeal.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ordeal.uid, eventReasonEffectId: 3 },
      { eventName: "cardsDrawn", eventCode: 1110, eventCardUid: drawCard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ordeal.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function createRestoredBattleState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71331216, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ordealCode, warRockCode, drawCardCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  const ordeal = moveFaceUpSpellTrap(session, requireCard(session, ordealCode), 0, 0);
  expect(addDuelCardCounter(ordeal, counterWarRock, 1)).toBe(true);
  moveFaceUpAttack(session, requireCard(session, warRockCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerOrdeal(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const ordeal = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ordealCode);
  expect(ordeal).toBeDefined();
  return [
    ordeal!,
    { code: warRockCode, name: "War Rock Ordeal Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setWarRock], level: 4, attack: 2000, defense: 1000 },
    { code: battleTargetCode, name: "War Rock Ordeal Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: drawCardCode, name: "War Rock Ordeal Draw Card", kind: "spell", typeFlags: typeSpell | typeContinuous },
  ];
}

function registerOrdeal(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ordealCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--War Rock Ordeal");
  expect(script).toContain("c:EnableCounterPermit(0x205)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e:GetHandler():AddCounter(0x205,3)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER+CATEGORY_DRAW)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("rc:IsControler(tp) and tc:IsMonster() and tc:IsReason(REASON_BATTLE)");
  expect(script).toContain("rc:IsSetCard(SET_WAR_ROCK)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),1,tp,LOCATION_SZONE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x205,1,REASON_EFFECT)");
  expect(script).toContain("Duel.RaiseEvent(c,EVENT_REMOVE_COUNTER+0x205,e,REASON_EFFECT,tp,tp,1)");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE_COUNTER+0x205)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x205)==0");
  expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");
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

function attackAndReachBattleDestroyedTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
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
