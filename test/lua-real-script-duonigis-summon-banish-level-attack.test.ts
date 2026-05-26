import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const duonigisCode = "79724755";
const waterAllyCode = "797247550";
const levelTargetCode = "797247551";
const earthDecoyCode = "797247552";
const opponentTopACode = "797247553";
const opponentTopBCode = "797247554";
const opponentTopCCode = "797247555";
const banishedMonsterCode = "797247556";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDuonigisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${duonigisCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const attributeWater = 0x2;
const raceSeaSerpent = 0x200;
const raceAqua = 0x40;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasDuonigisScript)("Lua real script Guitar Gurnards Duonigis summon banish level attack", () => {
  it("restores summon-success deck-top banish, WATER Level boost, and grave self-banish ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${duonigisCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 79724755, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [duonigisCode, waterAllyCode, levelTargetCode, earthDecoyCode, banishedMonsterCode] },
      1: { main: [opponentTopACode, opponentTopBCode, opponentTopCCode] },
    });
    startDuel(session);

    const duonigis = requireCard(session, duonigisCode);
    const waterAlly = requireCard(session, waterAllyCode);
    const levelTarget = requireCard(session, levelTargetCode);
    const earthDecoy = requireCard(session, earthDecoyCode);
    const opponentTopA = requireCard(session, opponentTopACode);
    const opponentTopB = requireCard(session, opponentTopBCode);
    const opponentTopC = requireCard(session, opponentTopCCode);
    const banishedMonster = requireCard(session, banishedMonsterCode);
    moveDuelCard(session.state, duonigis.uid, "hand", 0);
    moveFaceUpAttack(session, waterAlly, 0);
    moveFaceUpAttack(session, levelTarget, 0);
    moveFaceUpAttack(session, earthDecoy, 0);
    moveDuelCard(session.state, banishedMonster.uid, "banished", 0, duelReason.effect, 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(duonigisCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, duonigis.uid, 0);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === duonigis.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1102",
        eventCardUid: duonigis.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 3 },
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: duonigis.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === duonigis.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    for (const opponentCard of [opponentTopA, opponentTopB, opponentTopC]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentCard.uid)).toMatchObject({
        location: "banished",
        controller: 1,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: duonigis.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentTopA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: duonigis.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentTopC.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: duonigis.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentTopB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: duonigis.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentTopA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: duonigis.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "banished" },
    ]);

    const restoredLevelOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredLevelOpen);
    expectRestoredLegalActions(restoredLevelOpen, 0);
    const levelAction = getLuaRestoreLegalActions(restoredLevelOpen, 0).find((action) => action.type === "activateEffect" && action.uid === duonigis.uid && action.effectId === "lua-2");
    expect(levelAction, JSON.stringify(getLuaRestoreLegalActions(restoredLevelOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLevelOpen, levelAction!);
    expect(restoredLevelOpen.session.state.chain).toEqual([]);
    passRestoredChain(restoredLevelOpen);

    expect(currentLevel(restoredLevelOpen.session.state.cards.find((card) => card.uid === duonigis.uid), restoredLevelOpen.session.state)).toBe(3);
    expect(currentLevel(restoredLevelOpen.session.state.cards.find((card) => card.uid === waterAlly.uid), restoredLevelOpen.session.state)).toBe(8);
    expect(currentLevel(restoredLevelOpen.session.state.cards.find((card) => card.uid === levelTarget.uid), restoredLevelOpen.session.state)).toBe(3);
    expect(currentLevel(restoredLevelOpen.session.state.cards.find((card) => card.uid === earthDecoy.uid), restoredLevelOpen.session.state)).toBe(4);
    expect(restoredLevelOpen.session.state.effects.filter((effect) => effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: waterAlly.uid, value: 4 },
    ]);

    moveDuelCard(restoredLevelOpen.session.state, duonigis.uid, "graveyard", 0, duelReason.effect, 0).faceUp = true;
    restoredLevelOpen.session.state.waitingFor = 0;
    const restoredAttackOpen = restoreDuelWithLuaScripts(serializeDuel(restoredLevelOpen.session), workspace, reader);
    expectCleanRestore(restoredAttackOpen);
    expectRestoredLegalActions(restoredAttackOpen, 0);
    const attackAction = getLuaRestoreLegalActions(restoredAttackOpen, 0).find((action) => action.type === "activateEffect" && action.uid === duonigis.uid && action.effectId === "lua-3");
    expect(attackAction, JSON.stringify(getLuaRestoreLegalActions(restoredAttackOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackOpen, attackAction!);
    passRestoredChain(restoredAttackOpen);

    expect(restoredAttackOpen.session.state.cards.find((card) => card.uid === duonigis.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: duonigis.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredAttackOpen.session.state.cards.find((card) => card.uid === waterAlly.uid), restoredAttackOpen.session.state)).toBe(2300);
    expect(currentAttack(restoredAttackOpen.session.state.cards.find((card) => card.uid === earthDecoy.uid), restoredAttackOpen.session.state)).toBe(1800);
    expect(restoredAttackOpen.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: waterAlly.uid, value: 500 },
    ]);
    expect(restoredAttackOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetDecktopGroup(1-tp,ct):FilterCount(Card.IsAbleToRemove,nil)==ct");
  expect(script).toContain("Duel.DisableShuffleCheck()");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelBelow(4) and c:IsAttribute(ATTRIBUTE_WATER)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e1:SetValue(tc:GetOriginalLevel())");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*100)");
}

function cards(): DuelCardData[] {
  return [
    { code: duonigisCode, name: "Guitar Gurnards Duonigis", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 3, attack: 1500, defense: 700 },
    { code: waterAllyCode, name: "Duonigis WATER ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1800, defense: 1200 },
    { code: levelTargetCode, name: "Duonigis WATER Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 3, attack: 1200, defense: 1000 },
    { code: earthDecoyCode, name: "Duonigis EARTH Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: opponentTopACode, name: "Duonigis Opponent Deck Card A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTopBCode, name: "Duonigis Opponent Deck Card B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTopCCode, name: "Duonigis Opponent Deck Card C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: banishedMonsterCode, name: "Duonigis Pre-Banished Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
