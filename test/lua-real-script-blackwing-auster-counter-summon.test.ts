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
const austerCode = "17465972";
const banishedBlackwingCode = "174659720";
const blackWingedDragonCode = "9012916";
const opponentWedgeTargetACode = "174659721";
const opponentWedgeTargetBCode = "174659722";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAusterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${austerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeDragon = 0x2000;
const raceWingedBeast = 0x80;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setBlackwing = 0x33;
const featherCounter = 0x10;
const wedgeCounter = 0x1002;
const chooseFeatherBranch = [{ api: "SelectOption" as const, player: 0 as const, returned: 0 }];
const chooseWedgeBranch = [{ api: "SelectOption" as const, player: 0 as const, returned: 1 }];

describe.skipIf(!hasUpstreamScripts || !hasAusterScript)("Lua real script Blackwing Auster counter summon", () => {
  it("restores summon revival and grave SelfBanish counter branch choices", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAusterScriptShape(workspace.readScript(`official/c${austerCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());

    const restoredSummonOpen = createRestoredSummonField({ reader, source });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonAuster = requireCard(restoredSummonOpen.session, austerCode);
    const banishedBlackwing = requireCard(restoredSummonOpen.session, banishedBlackwingCode);
    applyRestoredActionAndAssert(restoredSummonOpen, requireAction(restoredSummonOpen, summonAuster.uid, "normalSummon"));

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1100", eventCardUid: summonAuster.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: summonAuster.uid, triggerBucket: "turnOptional" },
    ]);
    applyRestoredActionAndAssert(restoredSummonTrigger, requireAction(restoredSummonTrigger, summonAuster.uid, "activateTrigger"));
    resolveRestoredChain(restoredSummonTrigger);
    expect(findCard(restoredSummonTrigger.session, banishedBlackwing.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonAuster.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "specialSummoned"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: summonAuster.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: banishedBlackwing.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: banishedBlackwing.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonAuster.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "banished", current: "monsterZone" },
    ]);

    const restoredFeather = createRestoredCounterField({ reader, source, promptOverrides: chooseFeatherBranch });
    expectCleanRestore(restoredFeather);
    expectRestoredLegalActions(restoredFeather, 0);
    const featherAuster = requireCard(restoredFeather.session, austerCode);
    const blackWingedDragon = requireCard(restoredFeather.session, blackWingedDragonCode);
    applyRestoredActionAndAssert(restoredFeather, requireAction(restoredFeather, featherAuster.uid, "activateEffect"));
    resolveRestoredChain(restoredFeather);
    expect(getDuelCardCounter(findCard(restoredFeather.session, blackWingedDragon.uid), featherCounter)).toBe(2);
    expect(restoredFeather.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption")).toMatchObject([
      { api: "SelectOption", options: [0, 1], player: 0, returned: 0 },
    ]);
    expect(restoredFeather.session.state.eventHistory.filter((event) => ["banished", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: featherAuster.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: featherAuster.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: blackWingedDragon.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: featherAuster.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
    ]);

    const restoredWedge = createRestoredCounterField({ reader, source, promptOverrides: chooseWedgeBranch });
    expectCleanRestore(restoredWedge);
    expectRestoredLegalActions(restoredWedge, 0);
    const wedgeAuster = requireCard(restoredWedge.session, austerCode);
    const wedgeA = requireCard(restoredWedge.session, opponentWedgeTargetACode);
    const wedgeB = requireCard(restoredWedge.session, opponentWedgeTargetBCode);
    applyRestoredActionAndAssert(restoredWedge, requireAction(restoredWedge, wedgeAuster.uid, "activateEffect"));
    resolveRestoredChain(restoredWedge);
    expect(getDuelCardCounter(findCard(restoredWedge.session, wedgeA.uid), wedgeCounter)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredWedge.session, wedgeB.uid), wedgeCounter)).toBe(1);
    expect(restoredWedge.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption")).toMatchObject([
      { api: "SelectOption", options: [0, 1], player: 0, returned: 1 },
    ]);
    expect(restoredWedge.session.state.eventHistory.filter((event) => ["banished", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: wedgeAuster.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: wedgeAuster.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: wedgeA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wedgeAuster.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: wedgeB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wedgeAuster.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function createRestoredSummonField({
  reader,
  source,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17465972, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [austerCode, banishedBlackwingCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, austerCode).uid, "hand", 0);
  const target = moveDuelCard(session.state, requireCard(session, banishedBlackwingCode).uid, "banished", 0);
  target.faceUp = true;
  openMain(session);
  registerScripts(session, source, [austerCode]);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredCounterField({
  reader,
  source,
  promptOverrides,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  promptOverrides: typeof chooseFeatherBranch;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: promptOverrides[0]!.returned === 0 ? 17465973 : 17465974, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [austerCode, blackWingedDragonCode] }, 1: { main: [opponentWedgeTargetACode, opponentWedgeTargetBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, austerCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, blackWingedDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentWedgeTargetACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentWedgeTargetBCode), 1, 1);
  openMain(session);
  registerScripts(session, source, [austerCode, blackWingedDragonCode, opponentWedgeTargetACode, opponentWedgeTargetBCode], promptOverrides);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if ([blackWingedDragonCode, opponentWedgeTargetACode, opponentWedgeTargetBCode].some((code) => name === `c${code}.lua`)) return counterPermitScript();
      return workspace.readScript(name);
    },
  };
}

function counterPermitScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_FEATHER)
      c:EnableCounterPermit(0x1002)
    end
  `;
}

function registerScripts(session: DuelSession, source: ScriptSource, codes: string[], promptOverrides?: typeof chooseFeatherBranch): void {
  const host = createLuaScriptHost(session, source, promptOverrides ? { promptOverrides } : undefined);
  for (const code of codes) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(codes.length);
}

function expectAusterScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Blackwing - Auster the South Wind");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_REMOVED,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)>0");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,2),aux.Stringid(id,3))");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsCode,CARD_BLACK_WINGED_DRAGON),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
  expect(script).toContain("tc:AddCounter(COUNTER_FEATHER,ct)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.wcfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("tc:AddCounter(0x1002,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: austerCode, name: "Blackwing - Auster the South Wind", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1300, defense: 0 },
    { code: banishedBlackwingCode, name: "Auster Banished Blackwing", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: blackWingedDragonCode, name: "Black-Winged Dragon", kind: "monster", typeFlags: typeMonster | typeEffect | typeDragon, race: raceDragon, attribute: attributeDark, level: 8, attack: 2800, defense: 1600 },
    { code: opponentWedgeTargetACode, name: "Auster Wedge Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1700, defense: 1200 },
    { code: opponentWedgeTargetBCode, name: "Auster Wedge Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1300 },
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
