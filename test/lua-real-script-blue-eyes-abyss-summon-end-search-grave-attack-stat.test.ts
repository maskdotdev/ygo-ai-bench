import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const abyssCode = "64202399";
const blueEyesCode = "89631139";
const ritualSearchCode = "642023990";
const offSpellDecoyCode = "642023991";
const dragonSearchCode = "642023992";
const lowDragonDecoyCode = "642023993";
const warriorDecoyCode = "642023994";
const statDragonACode = "642023995";
const statDragonBCode = "642023996";
const statLowDragonCode = "642023997";
const statWarriorCode = "642023998";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAbyssScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abyssCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetEventStandard = 0x1fe1000;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAbyssScript)("Lua real script Blue-Eyes Abyss Dragon summon End Phase search grave ATK stat", () => {
  it("restores Special Summon Ritual Spell search, End Phase Dragon search, and graveyard self-banish ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abyssCode}.lua`);
    expectBlueEyesAbyssScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const abyssData = databaseCards.find((card) => card.code === abyssCode);
    const blueEyesData = databaseCards.find((card) => card.code === blueEyesCode);
    expect(abyssData).toBeDefined();
    expect(blueEyesData).toBeDefined();
    const reader = createCardReader([
      abyssData!,
      blueEyesData!,
      ...fixtureCards(),
    ]);

    const restoredSummon = createRestoredSpecialSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonAbyss = requireCard(restoredSummon.session, abyssCode);
    const ritualSearch = requireCard(restoredSummon.session, ritualSearchCode);
    const offSpellDecoy = requireCard(restoredSummon.session, offSpellDecoyCode);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: summonAbyss.uid,
        effectId: "lua-1-1102",
        eventName: "specialSummoned",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventCode: 1102,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: summonAbyss.uid,
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === summonAbyss.uid && action.effectId === "lua-1-1102",
    );
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    expect(restoredSummon.session.state.chain).toEqual([]);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === ritualSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonAbyss.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === offSpellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    const ritualPreviousSequence = restoredSummon.session.state.cards.find((card) => card.uid === ritualSearch.uid)?.previousSequence ?? 0;
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      specialSummonedEvent(summonAbyss.uid),
      sentToHandEvent(ritualSearch.uid, summonAbyss.uid, 1, ritualPreviousSequence),
      confirmedEvent(ritualSearch.uid, summonAbyss.uid, 1, ritualPreviousSequence),
      sentToHandConfirmedEvent(ritualSearch.uid, summonAbyss.uid, 1, ritualPreviousSequence),
    ]);

    const restoredEndOpen = createRestoredEndPhaseWindow({ reader, workspace });
    expectCleanRestore(restoredEndOpen);
    expectRestoredLegalActions(restoredEndOpen, 0);
    const endAbyss = requireCard(restoredEndOpen.session, abyssCode);
    const dragonSearch = requireCard(restoredEndOpen.session, dragonSearchCode);
    const lowDragonDecoy = requireCard(restoredEndOpen.session, lowDragonDecoyCode);
    const warriorDecoy = requireCard(restoredEndOpen.session, warriorDecoyCode);
    const endPhase = getLuaRestoreLegalActions(restoredEndOpen, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndOpen, endPhase!);

    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEndOpen.session), workspace, reader);
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    expect(restoredEndTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: endAbyss.uid,
        effectId: "lua-2-4608",
        eventName: "phaseEnd",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "when",
        eventCode: phaseEndEventCode,
      },
    ]);
    const endTrigger = getLuaRestoreLegalActions(restoredEndTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === endAbyss.uid && action.effectId === "lua-2-4608",
    );
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndTrigger, endTrigger!);
    expect(restoredEndTrigger.session.state.chain).toEqual([]);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === dragonSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: endAbyss.uid,
      reasonEffectId: 2,
    });
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === lowDragonDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    const dragonPreviousSequence = restoredEndTrigger.session.state.cards.find((card) => card.uid === dragonSearch.uid)?.previousSequence ?? 0;
    expect(restoredEndTrigger.session.state.eventHistory.filter((event) => ["phaseEnd", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
      sentToHandEvent(dragonSearch.uid, endAbyss.uid, 2, dragonPreviousSequence),
      confirmedEvent(dragonSearch.uid, endAbyss.uid, 2, dragonPreviousSequence),
      sentToHandConfirmedEvent(dragonSearch.uid, endAbyss.uid, 2, dragonPreviousSequence),
    ]);

    const restoredStat = createRestoredStatWindow({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAbyss = requireCard(restoredStat.session, abyssCode);
    const statDragonA = requireCard(restoredStat.session, statDragonACode);
    const statDragonB = requireCard(restoredStat.session, statDragonBCode);
    const statLowDragon = requireCard(restoredStat.session, statLowDragonCode);
    const statWarrior = requireCard(restoredStat.session, statWarriorCode);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find(
      (action) => action.type === "activateEffect" && action.uid === statAbyss.uid && action.effectId === "lua-3",
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.chain).toEqual([]);
    expect(restoredStat.session.state.cards.find((card) => card.uid === statAbyss.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statAbyss.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statDragonA.uid), restoredStat.session.state)).toBe(3100);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statDragonB.uid), restoredStat.session.state)).toBe(3400);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statLowDragon.uid), restoredStat.session.state)).toBe(1800);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statWarrior.uid), restoredStat.session.state)).toBe(2300);
    expect(restoredStat.session.state.effects.filter((effect) => [statDragonA.uid, statDragonB.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetEventStandard }, sourceUid: statDragonA.uid, value: 1000 },
      { code: effectUpdateAttack, reset: { flags: resetEventStandard }, sourceUid: statDragonB.uid, value: 1000 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["banished", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
    }))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: statAbyss.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: statAbyss.uid,
        eventReasonEffectId: 3,
        eventPlayer: undefined,
        eventValue: undefined,
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventPlayer: 0,
        eventValue: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: ritualSearchCode, name: "Blue-Eyes Abyss Ritual Search Spell", kind: "spell", typeFlags: typeSpell | typeRitual },
    { code: offSpellDecoyCode, name: "Blue-Eyes Abyss Off-Filter Spell", kind: "spell", typeFlags: typeSpell },
    { code: dragonSearchCode, name: "Blue-Eyes Abyss Level 8 Dragon Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: lowDragonDecoyCode, name: "Blue-Eyes Abyss Level 7 Dragon Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 7, attack: 2000, defense: 2000 },
    { code: warriorDecoyCode, name: "Blue-Eyes Abyss Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 8, attack: 2200, defense: 1500 },
    { code: statDragonACode, name: "Blue-Eyes Abyss Stat Dragon A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2100, defense: 2000 },
    { code: statDragonBCode, name: "Blue-Eyes Abyss Stat Dragon B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 9, attack: 2400, defense: 2200 },
    { code: statLowDragonCode, name: "Blue-Eyes Abyss Stat Level 7 Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 7, attack: 1800, defense: 1500 },
    { code: statWarriorCode, name: "Blue-Eyes Abyss Stat Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 8, attack: 2300, defense: 1500 },
  ];
}

function createRestoredSpecialSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64202399, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [abyssCode, blueEyesCode, ritualSearchCode, offSpellDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  const abyss = requireCard(session, abyssCode);
  const blueEyes = requireCard(session, blueEyesCode);
  moveDuelCard(session.state, abyss.uid, "hand", 0);
  const movedBlueEyes = moveDuelCard(session.state, blueEyes.uid, "graveyard", 0);
  movedBlueEyes.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(abyssCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  specialSummonDuelCard(session.state, abyss.uid, 0, 0, {}, undefined, true, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredEndPhaseWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64202400, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [abyssCode, blueEyesCode, dragonSearchCode, lowDragonDecoyCode, warriorDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, abyssCode), 0, 0);
  const movedBlueEyes = moveDuelCard(session.state, requireCard(session, blueEyesCode).uid, "graveyard", 0);
  movedBlueEyes.faceUp = true;
  session.state.phase = "main2";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(abyssCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStatWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64202401, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [abyssCode, blueEyesCode, statDragonACode, statDragonBCode, statLowDragonCode, statWarriorCode] }, 1: { main: [] } });
  startDuel(session);
  const movedAbyss = moveDuelCard(session.state, requireCard(session, abyssCode).uid, "graveyard", 0);
  movedAbyss.faceUp = true;
  movedAbyss.position = "faceUpAttack";
  const movedBlueEyes = moveDuelCard(session.state, requireCard(session, blueEyesCode).uid, "graveyard", 0);
  movedBlueEyes.faceUp = true;
  moveFaceUpAttack(session, requireCard(session, statDragonACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, statDragonBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, statLowDragonCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, statWarriorCode), 0, 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(abyssCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectBlueEyesAbyssScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Blue-Eyes Abyss Dragon");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD|LOCATION_GRAVE,0,1,nil)");
  expect(script).toContain("return (c:IsCode(CARD_POLYMERIZATION) or c:IsRitualSpell()) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp) and s.condition(e,tp,eg,ep,ev,re,r,rp)");
  expect(script).toContain("return c:IsLevelAbove(8) and c:IsRace(RACE_DRAGON) and c:IsAbleToHand()");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelAbove(8) and c:IsRace(RACE_DRAGON)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
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

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
