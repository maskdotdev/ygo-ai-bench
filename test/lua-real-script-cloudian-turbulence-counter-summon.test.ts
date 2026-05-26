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
const turbulenceCode = "16197610";
const cloudianAllyCode = "161976100";
const smokeBallCode = "80825553";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTurbulenceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${turbulenceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const raceAqua = 0x40;
const attributeWater = 0x2;
const setCloudian = 0x18;
const counterFog = 0x1019;
const effectIndestructableBattle = 42;
const effectSelfDestroy = 141;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTurbulenceScript)("Lua real script Cloudian Turbulence counter summon", () => {
  it("restores Cloudian-count summon counters and Fog Counter Smoke Ball summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTurbulenceScriptShape(workspace.readScript(`official/c${turbulenceCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const turbulence = requireCard(restoredSummon.session, turbulenceCode);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === turbulence.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectIndestructableBattle, event: "continuous", property: undefined, range: ["hand"], value: 1 },
      { category: undefined, code: effectSelfDestroy, event: "continuous", property: 0x20000, range: ["monsterZone"], value: undefined },
      { category: 0x800000, code: 1100, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], value: undefined },
      { category: 0x200, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], value: undefined },
    ]);
    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, turbulence.uid, "normalSummon"));

    const restoredCounterTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounterTrigger);
    expectRestoredLegalActions(restoredCounterTrigger, 0);
    applyRestoredActionAndAssert(restoredCounterTrigger, requireAction(restoredCounterTrigger, turbulence.uid, "activateTrigger"));
    resolveRestoredChain(restoredCounterTrigger);
    expect(getDuelCardCounter(requireCard(restoredCounterTrigger.session, turbulenceCode), counterFog)).toBe(2);
    expect(restoredCounterTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: turbulence.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: turbulence.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: turbulence.uid, eventReasonEffectId: 3 },
    ]);

    const restoredSmokeBall = createRestoredSmokeBallState(reader, workspace);
    expectCleanRestore(restoredSmokeBall);
    expectRestoredLegalActions(restoredSmokeBall, 0);
    const summonTurbulence = requireCard(restoredSmokeBall.session, turbulenceCode);
    const smokeBall = requireCard(restoredSmokeBall.session, smokeBallCode);
    applyRestoredActionAndAssert(restoredSmokeBall, requireAction(restoredSmokeBall, summonTurbulence.uid, "activateEffect"));
    expect(getDuelCardCounter(findCard(restoredSmokeBall.session, summonTurbulence.uid), counterFog)).toBe(1);
    resolveRestoredChain(restoredSmokeBall);
    expect(findCard(restoredSmokeBall.session, smokeBall.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonTurbulence.uid,
      reasonEffectId: 4,
    });
    expect(restoredSmokeBall.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: summonTurbulence.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonTurbulence.uid, eventReasonEffectId: 4, previous: "deck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: smokeBall.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonTurbulence.uid, eventReasonEffectId: 4, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 16197610, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [turbulenceCode, cloudianAllyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, turbulenceCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, cloudianAllyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTurbulence(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSmokeBallState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 16197611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [turbulenceCode, smokeBallCode] }, 1: { main: [] } });
  startDuel(session);
  const turbulence = moveFaceUpAttack(session, requireCard(session, turbulenceCode), 0, 0);
  expect(addDuelCardCounter(turbulence, counterFog, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTurbulence(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerTurbulence(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(turbulenceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectTurbulenceScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Cloudian - Turbulence");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_CLOUDIAN),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)");
  expect(script).toContain("e4:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FOG,1,REASON_COST)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK|LOCATION_GRAVE,LOCATION_GRAVE,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_DECK|LOCATION_GRAVE,LOCATION_GRAVE,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const turbulence = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === turbulenceCode);
  expect(turbulence).toBeDefined();
  return [
    turbulence!,
    { code: cloudianAllyCode, name: "Turbulence Cloudian Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, setcodes: [setCloudian], level: 4, attack: 900, defense: 1000 },
    { code: smokeBallCode, name: "Cloudian - Smoke Ball", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceAqua, attribute: attributeWater, setcodes: [setCloudian], level: 1, attack: 200, defense: 600 },
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
