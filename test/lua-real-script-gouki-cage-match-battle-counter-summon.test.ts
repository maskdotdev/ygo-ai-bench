import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cageMatchCode = "85638822";
const attackerCodes = ["856388220", "856388221", "856388222"];
const defenderCodes = ["856388223", "856388224", "856388225"];
const summonCodes = ["856388226", "856388227"];
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCageMatchScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cageMatchCode}.lua`));
const counterGoukiCageMatch = 0x46;
const setGouki = 0xfc;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasCageMatchScript)("Lua real script Gouki Cage Match battle counter summon", () => {
  it("restores battle-destroying counter removals into Battle Phase end Gouki Special Summons and counter refill", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cageMatchCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 85638822, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cageMatchCode, ...attackerCodes, ...summonCodes] }, 1: { main: defenderCodes } });
    startDuel(session);

    const cageMatch = requireCard(session, cageMatchCode);
    const attackers = attackerCodes.map((code) => requireCard(session, code));
    const defenders = defenderCodes.map((code) => requireCard(session, code));
    const summons = summonCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, cageMatch.uid, "hand", 0);
    attackers.forEach((card, index) => moveFaceUpAttack(session, card, 0, index));
    defenders.forEach((card, index) => moveFaceUpAttack(session, card, 1, index));
    moveDuelCard(session.state, summons[0]!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cageMatchCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cageMatch.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);
    expect(getDuelCardCounter(findCard(restoredOpen.session, cageMatch.uid), counterGoukiCageMatch)).toBe(3);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    for (const [index, attacker] of attackers.entries()) {
      const restored = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
      expectCleanRestore(restored);
      expectRestoredLegalActions(restored, 0);
      const attack = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defenders[index]!.uid);
      expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, attack!);
      passRestoredBattleUntil(restored, () => getDuelCardCounter(findCard(restored.session, cageMatch.uid), counterGoukiCageMatch) === 2 - index);
      restoredOpen.session = restored.session;
    }

    const restoredEndBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredEndBattle);
    expectRestoredLegalActions(restoredEndBattle, 0);
    const changeMain2 = getLuaRestoreLegalActions(restoredEndBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(changeMain2, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndBattle, changeMain2!);
    const summonTrigger = getLuaRestoreLegalActions(restoredEndBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === cageMatch.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndBattle, summonTrigger!);
    resolveRestoredChain(restoredEndBattle);

    expect(summons.map((card) => findCard(restoredEndBattle.session, card.uid)).map((card) => ({
      location: card.location,
      controller: card.controller,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
    }))).toEqual([
      { location: "monsterZone", controller: 0, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: cageMatch.uid, reasonEffectId: 4 },
      { location: "deck", controller: 0, reason: undefined, reasonCardUid: undefined, reasonEffectId: undefined },
    ]);
    expect(getDuelCardCounter(findCard(restoredEndBattle.session, cageMatch.uid), counterGoukiCageMatch)).toBe(3);
    expect(restoredEndBattle.session.state.eventHistory.filter((event) => ["counterAdded", "counterRemoved", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: cageMatch.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.effect, eventReasonCardUid: cageMatch.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: summons[0]!.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: cageMatch.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: cageMatch.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: cageMatch.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cageMatchCode, name: "Gouki Cage Match", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setGouki] },
    ...attackerCodes.map((code, index) => goukiMonster(code, `Gouki Cage Match Attacker ${index + 1}`, 2400)),
    ...defenderCodes.map((code, index) => ({ code, name: `Gouki Cage Match Defender ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 })),
    ...summonCodes.map((code, index) => goukiMonster(code, `Gouki Cage Match Summon ${index + 1}`, 1200 + index * 100)),
  ];
}

function goukiMonster(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], level: 4, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_GOUKI_CAGE_MATCH)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("Duel.IsCanAddCounter(tp,COUNTER_GOUKI_CAGE_MATCH,3,e:GetHandler())");
  expect(script).toContain("c:AddCounter(COUNTER_GOUKI_CAGE_MATCH,3)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("local bc=Duel.GetBattleMonster(tp)");
  expect(script).toContain("bc:IsSetCard(SET_GOUKI) and bc:IsControler(tp)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_GOUKI_CAGE_MATCH,1,REASON_EFFECT)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,EFFECT_FLAG_CANNOT_DISABLE,1)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_BATTLE)");
  expect(script).toContain("return c:GetCounter(COUNTER_GOUKI_CAGE_MATCH)==0 and c:HasFlagEffect(id,3)");
  expect(script).toContain("Duel.GetMatchingGroup(s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,nil,e,tp)");
  expect(script).toContain("aux.SelectUnselectGroup(tg,e,tp,1,ft,aux.dncheck,1,tp,HINTMSG_SPSUMMON)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("c:AddCounter(COUNTER_GOUKI_CAGE_MATCH,3)");
  expect(script).toContain("c:ResetFlagEffect(id)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
