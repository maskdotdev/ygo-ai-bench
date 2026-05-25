import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wynnCode = "60516416";
const windCostCode = "605164160";
const opponentTargetCode = "605164161";
const ownWindCode = "605164162";
const opponentDeckTargetCode = "605164163";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWynnScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wynnCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const categoryToDeck = 0x10;
const categoryControl = 0x2000;
const eventSpecialSummonSuccess = 1102;
const eventFreeChain = 1002;
const effectFlagCardTarget = 0x10;
const effectFlagDelay = 0x10000;
const summonTypeFusion = 0x43000000;

describe.skipIf(!hasUpstreamScripts || !hasWynnScript)("Lua real script Possessed Resonance Wynn control to-Deck", () => {
  it("restores Fusion Summon WIND graveyard bottom-deck cost into opponent control take", () => {
    const { workspace, reader, session } = createFixture(60516416);
    expectScriptShape(workspace.readScript(`official/c${wynnCode}.lua`));
    const wynn = requireCard(session, wynnCode);
    const windCost = requireCard(session, windCostCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, windCost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    prepareMainPhase(session, 0, 0);
    registerWynn(session, workspace);
    specialSummonDuelCard(session.state, wynn.uid, 0, 0, {}, summonTypeFusion, true, true);
    session.state.waitingFor = 0;

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === wynn.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventSpecialSummonSuccess, countLimit: 1, event: "trigger", id: `lua-2-${eventSpecialSummonSuccess}`, property: effectFlagDelay | effectFlagCardTarget, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryToDeck, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-3-${eventFreeChain}`, property: effectFlagCardTarget, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === wynn.uid && action.effectId === `lua-2-${eventSpecialSummonSuccess}`
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, windCost.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: wynn.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: wynn.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToDeck", eventCardUid: windCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: wynn.uid, eventReasonEffectId: 2, previousLocation: "graveyard", currentLocation: "deck", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wynn.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "monsterZone", previousController: 1, currentController: 0 },
    ]);
  });

  it("restores opponent-turn quick targeting into two-card bottom-deck placement", () => {
    const { workspace, reader, session } = createFixture(60516417);
    const wynn = requireCard(session, wynnCode);
    const ownWind = requireCard(session, ownWindCode);
    const opponentDeckTarget = requireCard(session, opponentDeckTargetCode);
    moveFaceUpFusion(session, wynn, 0, 0);
    moveFaceUpAttack(session, ownWind, 0, 1);
    moveFaceUpAttack(session, opponentDeckTarget, 1, 0);
    prepareMainPhase(session, 1, 0);
    registerWynn(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const quick = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === wynn.uid && action.effectId === `lua-3-${eventFreeChain}`
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, quick!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, wynn.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: wynn.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restored.session, ownWind.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: wynn.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restored.session, opponentDeckTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToDeck", eventCardUid: wynn.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wynn.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "extraDeck" },
      { eventName: "sentToDeck", eventCardUid: ownWind.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: wynn.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "deck" },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [windCostCode, ownWindCode], extra: [wynnCode] }, 1: { main: [opponentTargetCode, opponentDeckTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: wynnCode, name: "Possessed Resonance - Wynn", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeWind, level: 6, attack: 2400, defense: 1500 },
    { code: windCostCode, name: "Wynn WIND Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: ownWindCode, name: "Wynn Own WIND Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1400, defense: 1000 },
    { code: opponentTargetCode, name: "Wynn Opponent Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentDeckTargetCode, name: "Wynn Opponent Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Possessed Resonance - Wynn");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WIND))");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsFusionSummoned() end)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.controlcostfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetCondition(function(e,tp) return Duel.IsTurnPlayer(1-tp) end)");
  expect(script).toContain("Duel.GetTargetGroup(Card.IsAbleToDeck,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_TODECK)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.SendtoDeck(tg,nil,SEQ_DECKBOTTOM,REASON_EFFECT)");
  expect(script).toContain("Duel.SortDeckbottom(tp,tg:GetFirst():GetControler(),2)");
}

function registerWynn(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wynnCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function prepareMainPhase(session: DuelSession, turnPlayer: PlayerId, waitingFor: PlayerId): void {
  session.state.phase = "main1";
  session.state.turnPlayer = turnPlayer;
  session.state.waitingFor = waitingFor;
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

function moveFaceUpFusion(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveFaceUpAttack(session, card, controller, sequence);
  moved.summonType = "fusion";
  moved.summonTypeCode = summonTypeFusion;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
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
