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
const splashCaptureCode = "39765115";
const fieldFishCostCode = "397651150";
const graveFishCostCode = "397651151";
const nonFishDecoyCode = "397651152";
const opponentXyzCode = "397651153";
const chainStarterCode = "397651154";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSplashCaptureScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${splashCaptureCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFish = 0x20000;
const raceWarrior = 0x1;
const categoryControl = 0x2000;
const eventSpecialSummonSuccess = 1102;
const summonTypeXyz = 0x49000000;

describe.skipIf(!hasUpstreamScripts || !hasSplashCaptureScript)("Lua real script Splash Capture Xyz banish control", () => {
  it("restores opponent Xyz Summon response into two-Fish banish cost and control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${splashCaptureCode}.lua`);
    expect(script).toContain("--Splash Capture");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return tc:IsXyzSummoned() and tc:IsControler(1-tp)");
    expect(script).toContain("return c:IsRace(RACE_FISH) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,2,nil)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,2,2,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SetTargetCard(eg)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 39765115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [splashCaptureCode, fieldFishCostCode, graveFishCostCode, nonFishDecoyCode] },
      1: { main: [chainStarterCode], extra: [opponentXyzCode] },
    });
    startDuel(session);

    const splashCapture = requireCard(session, splashCaptureCode);
    const fieldFishCost = requireCard(session, fieldFishCostCode);
    const graveFishCost = requireCard(session, graveFishCostCode);
    const nonFishDecoy = requireCard(session, nonFishDecoyCode);
    const opponentXyz = requireCard(session, opponentXyzCode);
    const chainStarter = requireCard(session, chainStarterCode);
    moveSetTrap(session, splashCapture);
    moveDuelCard(session.state, fieldFishCost.uid, "graveyard", 0);
    moveDuelCard(session.state, graveFishCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, nonFishDecoy, 0, 0);
    moveDuelCard(session.state, chainStarter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(splashCaptureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, opponentXyz.uid, 1, 1, {}, summonTypeXyz);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === splashCapture.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      {
        category: categoryControl,
        code: eventSpecialSummonSuccess,
        event: "quick",
        id: `lua-1-${eventSpecialSummonSuccess}`,
        property: 0x10,
        triggerEvent: "specialSummoned",
      },
    ]);
    expectRestoredLegalActions(restoredTrigger, 1);
    const starter = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === chainStarter.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, starter!);

    const capture = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === splashCapture.uid && action.effectId === `lua-1-${eventSpecialSummonSuccess}`
    );
    expect(capture, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, capture!);
    expect(restoredTrigger.session.state.chain).toEqual([]);

    expect(findCard(restoredTrigger.session, fieldFishCost.uid)).toMatchObject({
      controller: 0,
      location: "banished",
      reason: duelReason.cost,
      reasonCardUid: splashCapture.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(findCard(restoredTrigger.session, graveFishCost.uid)).toMatchObject({
      controller: 0,
      location: "banished",
      reason: duelReason.cost,
      reasonCardUid: splashCapture.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(findCard(restoredTrigger.session, nonFishDecoy.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      sequence: 0,
    });
    expect(findCard(restoredTrigger.session, opponentXyz.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      previousController: 1,
      reason: duelReason.effect,
      reasonCardUid: splashCapture.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
      summonType: "xyz",
    });
    expect(findCard(restoredTrigger.session, splashCapture.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "banished", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { currentController: 1, currentLocation: "monsterZone", eventCardUid: opponentXyz.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previousController: 1, previousLocation: "extraDeck", relatedEffectId: undefined },
      { currentController: 0, currentLocation: "banished", eventCardUid: fieldFishCost.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: splashCapture.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 0, previousLocation: "graveyard", relatedEffectId: undefined },
      { currentController: 0, currentLocation: "banished", eventCardUid: graveFishCost.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: splashCapture.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 0, previousLocation: "graveyard", relatedEffectId: undefined },
      { currentController: 0, currentLocation: "banished", eventCardUid: fieldFishCost.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: splashCapture.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 0, previousLocation: "graveyard", relatedEffectId: undefined },
      { currentController: 1, currentLocation: "monsterZone", eventCardUid: opponentXyz.uid, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previousController: 1, previousLocation: "extraDeck", relatedEffectId: 1 },
      { currentController: 0, currentLocation: "monsterZone", eventCardUid: opponentXyz.uid, eventName: "controlChanged", eventReason: duelReason.effect, eventReasonCardUid: splashCapture.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previousController: 1, previousLocation: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 1);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: splashCaptureCode, name: "Splash Capture", kind: "trap", typeFlags: typeTrap },
    { code: fieldFishCostCode, name: "Splash Capture Field Fish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, level: 4, attack: 1200, defense: 1000 },
    { code: graveFishCostCode, name: "Splash Capture Grave Fish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, level: 4, attack: 1300, defense: 1000 },
    { code: nonFishDecoyCode, name: "Splash Capture Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
    { code: opponentXyzCode, name: "Splash Capture Opponent Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, level: 4, attack: 2300, defense: 1800 },
    { code: chainStarterCode, name: "Splash Capture Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp,eg) return eg:IsExists(Card.IsControler,1,nil,tp) end)
      e:SetOperation(function(e,tp) Debug.Message("splash capture starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function moveSetTrap(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
