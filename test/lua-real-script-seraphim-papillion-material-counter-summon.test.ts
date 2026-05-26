import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const papillionCode = "91140491";
const insectMaterialACode = "911404910";
const warriorMaterialCode = "911404911";
const insectMaterialBCode = "911404912";
const graveInsectCode = "911404913";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPapillionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${papillionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceWarrior = 0x1;
const raceInsect = 0x800;
const attributeWind = 0x10;
const attributeEarth = 0x1;
const counterPapillon = 0x14d;
const effectUpdateAttack = 100;
const linkSummonReason = duelReason.link | duelReason.summon | duelReason.specialSummon;

describe.skipIf(!hasUpstreamScripts || !hasPapillionScript)("Lua real script Seraphim Papillion material counter summon", () => {
  it("restores material-check Papillon counters, counter attack scaling, and counter-cost grave summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${papillionCode}.lua`));
    const reader = createCardReader(cards());
    const restoredCounter = createRestoredPreLinkState({ reader, workspace });
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const insectMaterialA = requireCard(restoredCounter.session, insectMaterialACode);
    const warriorMaterial = requireCard(restoredCounter.session, warriorMaterialCode);
    const insectMaterialB = requireCard(restoredCounter.session, insectMaterialBCode);
    applyRestoredActionAndAssert(restoredCounter, requireLinkSummonAction(restoredCounter, [insectMaterialA.uid, warriorMaterial.uid, insectMaterialB.uid]));
    const papillion = requireCard(restoredCounter.session, papillionCode);
    expect(papillion.summonMaterialUids).toEqual([insectMaterialA.uid, warriorMaterial.uid, insectMaterialB.uid]);
    expect(restoredCounter.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-3-1102", eventCardUid: papillion.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: linkSummonReason, eventReasonPlayer: 0, player: 0, sourceUid: papillion.uid, triggerBucket: "turnMandatory" },
    ]);
    expect(restoredCounter.session.state.effects.filter((effect) => effect.sourceUid === papillion.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x20000, range: ["monsterZone"], valuePredicate: "function" },
    ]);
    applyRestoredActionAndAssert(restoredCounter, requireAction(restoredCounter, papillion.uid, "activateTrigger"));
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, papillionCode), counterPapillon)).toBe(2);
    expect(currentAttack(requireCard(restoredCounter.session, papillionCode), restoredCounter.session.state)).toBe(2500);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["specialSummoned", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: papillion.uid, eventReason: linkSummonReason, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: papillion.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: papillion.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);

    restoredCounter.session.state.turn += 2;
    restoredCounter.session.state.phase = "main1";
    restoredCounter.session.state.turnPlayer = 0;
    restoredCounter.session.state.waitingFor = 0;
    restoredCounter.session.state.usedCountKeys = [];
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, papillion.uid, "activateEffect"));
    expect(getDuelCardCounter(requireCard(restoredSummon.session, papillionCode), counterPapillon)).toBe(1);
    expect(currentAttack(requireCard(restoredSummon.session, papillionCode), restoredSummon.session.state)).toBe(2300);
    resolveRestoredChain(restoredSummon);
    expect(findCard(restoredSummon.session, requireCard(restoredSummon.session, graveInsectCode).uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: papillion.uid,
      reasonEffectId: 6,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned"].includes(event.eventName)).slice(-2).map(slimEvent)).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: papillion.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: papillion.uid, eventReasonEffectId: 6, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: requireCard(restoredSummon.session, graveInsectCode).uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: papillion.uid, eventReasonEffectId: 6, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
  });
});

function createRestoredPreLinkState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 91140491, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [insectMaterialACode, warriorMaterialCode, insectMaterialBCode, graveInsectCode], extra: [papillionCode] }, 1: { main: [] } });
  startDuel(session);
  const insectMaterialA = moveFaceUpAttack(session, requireCard(session, insectMaterialACode), 0, 0);
  const warriorMaterial = moveFaceUpAttack(session, requireCard(session, warriorMaterialCode), 0, 1);
  const insectMaterialB = moveFaceUpAttack(session, requireCard(session, insectMaterialBCode), 0, 2);
  moveDuelCard(session.state, requireCard(session, graveInsectCode).uid, "graveyard", 0).faceUp = true;
  openMain(session);
  registerPapillion(session, workspace);
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerPapillion(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(papillionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Seraphim Papillion");
  expect(script).toContain("local COUNTER_PAPILLON=0x14d");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_PAPILLON)");
  expect(script).toContain("Link.AddProcedure(c,nil,2,3,s.lcheck)");
  expect(script).toContain("return g:CheckDifferentProperty(Card.GetCode,lc,sumtype,tp)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e2:SetValue(s.valcheck)");
  expect(script).toContain("e:GetLabelObject():SetLabel(c:GetMaterial():FilterCount(Card.IsRace,nil,RACE_INSECT,c,SUMMON_TYPE_LINK))");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:GetCounter(COUNTER_PAPILLON)*200");
  expect(script).toContain("c:IsCanRemoveCounter(tp,COUNTER_PAPILLON,1,REASON_COST)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_PAPILLON,1,REASON_COST)");
  expect(script).toContain("c:IsRace(RACE_INSECT) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: papillionCode, name: "Seraphim Papillion", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceInsect, attribute: attributeWind, level: 3, attack: 2100, defense: 0, linkMarkers: 0x45, linkMaterialMin: 2, linkMaterialMax: 3 },
    { code: insectMaterialACode, name: "Papillion Insect Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: warriorMaterialCode, name: "Papillion Warrior Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000 },
    { code: insectMaterialBCode, name: "Papillion Insect Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: graveInsectCode, name: "Papillion Grave Insect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
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

function openMain(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function requireLinkSummonAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, materialUids: string[]): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
    candidate.type === "linkSummon" &&
    candidate.uid === requireCard(restored.session, papillionCode).uid &&
    JSON.stringify(candidate.materialUids) === JSON.stringify(materialUids));
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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
