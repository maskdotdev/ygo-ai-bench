import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
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
const overlordCode = "63253763";
const alienDefenderCode = "632537630";
const opponentCounterCode = "632537631";
const opponentSecondCode = "632537632";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOverlordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${overlordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeLight = 0x10;
const setAlien = 0xc;
const counterA = 0x100e;
const categoryCounter = 0x800000;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasOverlordScript)("Lua real script Alien Overlord counter procedure stat", () => {
  it("restores counter-cost Special Summon, field counter spread, and Alien battle stat reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectOverlordScriptShape(workspace.readScript(`official/c${overlordCode}.lua`));
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if ([opponentCounterCode, opponentSecondCode].some((code) => name === `c${code}.lua`)) return counterPermitScript();
        return workspace.readScript(name);
      },
    };
    const restoredOpen = createRestoredOpen({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const overlord = requireCard(restoredOpen.session, overlordCode);
    const countered = requireCard(restoredOpen.session, opponentCounterCode);
    const secondOpponent = requireCard(restoredOpen.session, opponentSecondCode);

    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === overlord.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: undefined, code: 34, countLimit: undefined, event: "summonProcedure", id: "lua-1-34", property: 262144, range: ["hand"], targetRange: undefined },
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-2", property: undefined, range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-3-100", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
      { category: undefined, code: effectUpdateDefense, countLimit: undefined, event: "continuous", id: "lua-4-104", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
    ]);

    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "specialSummonProcedure" && action.uid === overlord.uid
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, procedure!);
    expect(findCard(restoredOpen.session, overlord.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, countered.uid), counterA)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: countered.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: overlord.uid, eventReasonEffectId: 1 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: overlord.uid, eventReason: duelReason.specialSummon | duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === overlord.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    expect(getDuelCardCounter(findCard(restoredIgnition.session, countered.uid), counterA)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredIgnition.session, secondOpponent.uid), counterA)).toBe(1);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "counterAdded").slice(-2).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: countered.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: overlord.uid, eventReasonEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: secondOpponent.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: overlord.uid, eventReasonEffectId: 2 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const alienDefender = requireCard(restoredBattle.session, alienDefenderCode);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === alienDefender.uid && action.targetUid === countered.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilDamageCalculation(restoredBattle);

    expect(restoredBattle.session.state.battleStep).toBe("damageCalculation");
    expect(currentAttack(findCard(restoredBattle.session, countered.uid), restoredBattle.session.state)).toBe(1500);
    expect(currentDefense(findCard(restoredBattle.session, countered.uid), restoredBattle.session.state)).toBe(1100);
    expect(currentAttack(findCard(restoredBattle.session, alienDefender.uid), restoredBattle.session.state)).toBe(1400);
    expect(currentDefense(findCard(restoredBattle.session, alienDefender.uid), restoredBattle.session.state)).toBe(1200);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 63253763, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [overlordCode, alienDefenderCode] }, 1: { main: [opponentCounterCode, opponentSecondCode] } });
  startDuel(session);
  const overlord = moveDuelCard(session.state, requireCard(session, overlordCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, alienDefenderCode), 0, 0);
  const countered = moveFaceUpAttack(session, requireCard(session, opponentCounterCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentSecondCode), 1, 1);
  expect(addDuelCardCounter(countered, counterA, 2)).toBe(true);
  expect(overlord.location).toBe("hand");
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(overlordCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentCounterCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentSecondCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: overlordCode, name: "Alien Overlord", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, setcodes: [setAlien], level: 6, attack: 2200, defense: 1600 },
    { code: alienDefenderCode, name: "Alien Overlord Battle Alien", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, setcodes: [setAlien], level: 4, attack: 1400, defense: 1200 },
    { code: opponentCounterCode, name: "Alien Overlord Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1800, defense: 1400 },
    { code: opponentSecondCode, name: "Alien Overlord Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function counterPermitScript(): string {
  return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_A) end";
}

function expectOverlordScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Alien Overlord");
  expect(script).toContain("c:SetUniqueOnField(1,0,id)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)");
  expect(script).toContain("Duel.IsCanRemoveCounter(c:GetControler(),1,1,COUNTER_A,2,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
  expect(script).toContain("local bc=c:GetBattleTarget()");
  expect(script).toContain("return bc and c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
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

function passBattleUntilDamageCalculation(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.battleStep !== "damageCalculation") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
