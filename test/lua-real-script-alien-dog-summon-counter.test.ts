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
const alienDogCode = "15475415";
const alienNormalCode = "154754150";
const opponentCounterTargetACode = "154754151";
const opponentCounterTargetBCode = "154754152";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlienDogScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienDogCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setAlien = 0xc;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasAlienDogScript)("Lua real script Alien Dog summon counter", () => {
  it("restores Alien summon hand trigger into procedure Special Summon and A-Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAlienDogScriptShape(workspace.readScript(`official/c${alienDogCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const dog = requireCard(session, alienDogCode);
    const alienNormal = requireCard(session, alienNormalCode);
    const targetA = requireCard(session, opponentCounterTargetACode);
    const targetB = requireCard(session, opponentCounterTargetBCode);
    registerScripts(session, source);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, alienNormal.uid, "normalSummon"));

    const restoredHandTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredHandTrigger);
    expectRestoredLegalActions(restoredHandTrigger, 0);
    expect(restoredHandTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: alienNormal.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: dog.uid, triggerBucket: "turnOptional" },
    ]);
    applyRestoredActionAndAssert(restoredHandTrigger, requireAction(restoredHandTrigger, dog.uid, "activateTrigger"));
    resolveRestoredChain(restoredHandTrigger);

    expect(restoredHandTrigger.session.state.cards.find((card) => card.uid === dog.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: dog.uid,
      reasonEffectId: 1,
    });

    const restoredCounterTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredHandTrigger.session), source, reader);
    expectCleanRestore(restoredCounterTrigger);
    expectRestoredLegalActions(restoredCounterTrigger, 0);
    expect(restoredCounterTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: dog.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, player: 0, sourceUid: dog.uid, triggerBucket: "turnMandatory" },
    ]);
    applyRestoredActionAndAssert(restoredCounterTrigger, requireAction(restoredCounterTrigger, dog.uid, "activateTrigger"));
    resolveRestoredChain(restoredCounterTrigger);

    expect(getDuelCardCounter(findCard(restoredCounterTrigger.session, targetA.uid), counterA)).toBe(2);
    expect(getDuelCardCounter(findCard(restoredCounterTrigger.session, targetB.uid), counterA)).toBe(0);
    expect(restoredCounterTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: alienNormal.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: dog.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: dog.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 65536, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dog.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 65536, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dog.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 15475415, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [alienDogCode, alienNormalCode] }, 1: { main: [opponentCounterTargetACode, opponentCounterTargetBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, alienDogCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, alienNormalCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentCounterTargetACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentCounterTargetBCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${opponentCounterTargetACode}.lua` || name === `c${opponentCounterTargetBCode}.lua`) return counterPermitScript();
      return workspace.readScript(name);
    },
  };
}

function counterPermitScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_A)
    end
  `;
}

function registerScripts(session: DuelSession, source: ScriptSource): void {
  const host = createLuaScriptHost(session, source);
  for (const code of [alienDogCode, opponentCounterTargetACode, opponentCounterTargetBCode]) {
    expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(3);
}

function expectAlienDogScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Alien Dog");
  expect(script).toContain("s.listed_series={SET_ALIEN}");
  expect(script).toContain("s.counter_place_list={COUNTER_A}");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("return ep==tp and eg:GetFirst():IsSetCard(SET_ALIEN)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("c:IsCanBeSpecialSummoned(e,1,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: alienDogCode, name: "Alien Dog", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeLight, level: 3, attack: 1500, defense: 1000 },
    { code: alienNormalCode, name: "Alien Dog Normal Summoned Alien", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
    { code: opponentCounterTargetACode, name: "Alien Dog Counter Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1700, defense: 1300 },
    { code: opponentCounterTargetBCode, name: "Alien Dog Counter Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1800, defense: 1400 },
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

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
