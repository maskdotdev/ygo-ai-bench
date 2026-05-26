import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const speleogeistCode = "47556396";
const defenderCode = "475563960";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpeleogeistScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${speleogeistCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSpeleogeistScript)("Lua real script Subterror Behemoth Speleogeist position flip stat", () => {
  it("restores turn-set hand Special Summon, flip position change, final ATK zero, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${speleogeistCode}.lua`));
    const reader = createCardReader(cards());

    const setSession = createDuel({ seed: 47556396, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(setSession, { 0: { main: [speleogeistCode, speleogeistCode] }, 1: { main: [] } });
    startDuel(setSession);
    const speleogeists = requireCards(setSession, speleogeistCode, 2);
    const fieldSpeleogeist = speleogeists[0]!;
    const handSpeleogeist = speleogeists[1]!;
    moveFaceUpAttack(setSession, fieldSpeleogeist, 0, 0);
    moveToHand(setSession, handSpeleogeist, 0);
    setSession.state.phase = "main1";
    setSession.state.turnPlayer = 0;
    setSession.state.waitingFor = 0;

    const setHost = createLuaScriptHost(setSession, workspace);
    expect(setHost.loadCardScript(Number(speleogeistCode), workspace).ok).toBe(true);
    expect(setHost.registerInitialEffects()).toBe(2);

    const restoredSetOpen = restoreDuelWithLuaScripts(serializeDuel(setSession), workspace, reader);
    expectCleanRestore(restoredSetOpen);
    expectRestoredLegalActions(restoredSetOpen, 0);
    const turnSet = getLuaRestoreLegalActions(restoredSetOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fieldSpeleogeist.uid);
    expect(turnSet, JSON.stringify(getLuaRestoreLegalActions(restoredSetOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetOpen, turnSet!);
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === fieldSpeleogeist.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceDownDefense", faceUp: false });
    expect(restoredSetOpen.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: fieldSpeleogeist.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldSpeleogeist.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);

    const restoredHandTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetOpen.session), workspace, reader);
    expectCleanRestore(restoredHandTrigger);
    expectRestoredLegalActions(restoredHandTrigger, 0);
    expect(restoredHandTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-5-1016",
        eventCardUid: fieldSpeleogeist.uid,
        eventCode: 1016,
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        eventName: "positionChanged",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonCardUid: fieldSpeleogeist.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: handSpeleogeist.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const handTrigger = getLuaRestoreLegalActions(restoredHandTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === handSpeleogeist.uid);
    expect(handTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredHandTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHandTrigger, handTrigger!);
    resolveRestoredChain(restoredHandTrigger);
    expect(restoredHandTrigger.session.state.cards.find((card) => card.uid === handSpeleogeist.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handSpeleogeist.uid,
      reasonEffectId: 5,
    });
    expect(restoredHandTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handSpeleogeist.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: handSpeleogeist.uid,
        eventReasonEffectId: 5,
        eventUids: [handSpeleogeist.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);

    const flipSession = createDuel({ seed: 47556397, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(flipSession, { 0: { main: [speleogeistCode] }, 1: { main: [defenderCode] } });
    startDuel(flipSession);
    const flipSpeleogeist = requireCard(flipSession, speleogeistCode);
    const defender = requireCard(flipSession, defenderCode);
    moveFaceDownDefense(flipSession, flipSpeleogeist, 0, 0);
    moveFaceUpDefense(flipSession, defender, 1, 0);
    flipSession.state.phase = "main1";
    flipSession.state.turnPlayer = 0;
    flipSession.state.waitingFor = 0;

    const flipHost = createLuaScriptHost(flipSession, workspace);
    expect(flipHost.loadCardScript(Number(speleogeistCode), workspace).ok).toBe(true);
    expect(flipHost.registerInitialEffects()).toBe(1);

    const restoredFlipOpen = restoreDuelWithLuaScripts(serializeDuel(flipSession), workspace, reader);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === flipSpeleogeist.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    expect(restoredFlipTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1",
        eventCardUid: flipSpeleogeist.uid,
        eventCode: 1001,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "flipSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: flipSpeleogeist.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    const flipTrigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === flipSpeleogeist.uid);
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, flipTrigger!);
    expect(restoredFlipTrigger.session.state.chain).toEqual([]);
    expect(restoredFlipTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack", faceUp: true });
    expect(currentAttack(restoredFlipTrigger.session.state.cards.find((card) => card.uid === defender.uid), restoredFlipTrigger.session.state)).toBe(0);
    expect(restoredFlipTrigger.session.state.effects.filter((effect) => effect.code === 102).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 33427456 }, sourceUid: defender.uid, value: 0 },
    ]);
    expect(restoredFlipTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: defender.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: defender.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: flipSpeleogeist.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    restoredFlipTrigger.session.state.phase = "battle";
    restoredFlipTrigger.session.state.turnPlayer = 0;
    restoredFlipTrigger.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const attack = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "declareAttack" && action.attackerUid === flipSpeleogeist.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, attack!);
    finishRestoredBattle(restoredFlipTrigger);
    expect(restoredFlipTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_POSITION+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsDefensePos() or c:GetAttack()>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("e2:SetCode(EVENT_CHANGE_POS)");
  expect(script).toContain("return c:IsPreviousPosition(POS_FACEUP) and c:IsFacedown() and c:IsControler(tp)");
  expect(script).toContain("and not Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("c:IsCanTurnSet() and c:GetFlagEffect(id)==0");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: speleogeistCode, name: "Subterror Behemoth Speleogeist", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: raceFiend, attribute: attributeEarth, level: 11, attack: 0, defense: 1400 },
    { code: defenderCode, name: "Speleogeist Position Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 2000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "hand", player);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
  moved.sequence = sequence;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
