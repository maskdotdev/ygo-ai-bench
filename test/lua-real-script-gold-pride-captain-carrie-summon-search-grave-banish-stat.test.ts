import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const carrieCode = "96305350";
const trapCode = "963053500";
const extraGoldPrideCode = "963053501";
const graveGoldPrideACode = "963053502";
const graveGoldPrideBCode = "963053503";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCarrieScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${carrieCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeSynchro = 0x2000;
const setGoldPride = 0x193;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasCarrieScript)("Lua real script Gold Pride Captain Carrie summon search grave banish stat", () => {
  it("restores LP-gated hand summon, delayed Trap search, and to-grave banish ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${carrieCode}.lua`);
    expectCarrieScriptShape(script);
    const reader = createCardReader(cards());
    const session = createCarrieSession(reader, workspace);
    const carrie = requireCard(session, carrieCode);
    const trap = requireCard(session, trapCode);
    const extraGoldPride = requireCard(session, extraGoldPrideCode);
    const graveA = requireCard(session, graveGoldPrideACode);
    const graveB = requireCard(session, graveGoldPrideBCode);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const special = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === carrie.uid && action.effectId === "lua-1");
    expect(special, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, special!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === carrie.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: carrie.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1102",
        eventCardUid: carrie.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: carrie.uid,
        eventReasonEffectId: 1,
        player: 0,
        sourceUid: carrie.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredSearchWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSearchWindow);
    expectRestoredLegalActions(restoredSearchWindow, 0);
    const search = getLuaRestoreLegalActions(restoredSearchWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === carrie.uid && action.effectId === "lua-3-1102");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearchWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchWindow, search!);
    expect(restoredSearchWindow.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredSearchWindow);

    expect(restoredSearchWindow.session.state.cards.find((card) => card.uid === trap.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: carrie.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearchWindow.host.messages).toContain(`confirmed 1: ${trapCode}`);
    expect(restoredSearchWindow.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: carrie.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: trap.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 3, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: trap.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 3, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: trap.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 3, previous: "deck", current: "hand" },
    ]);

    sendDuelCardToGraveyard(restoredSearchWindow.session.state, carrie.uid, 0, duelReason.effect, 0);
    const restoredGraveTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSearchWindow.session), workspace, reader);
    expectCleanRestore(restoredGraveTrigger);
    expectRestoredLegalActions(restoredGraveTrigger, 0);
    expect(restoredGraveTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-4-1014",
        eventCardUid: carrie.uid,
        eventCode: 1014,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect,
        player: 0,
        sourceUid: carrie.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const boost = getLuaRestoreLegalActions(restoredGraveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === carrie.uid && action.effectId === "lua-4-1014");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredGraveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGraveTrigger, boost!);
    expect(restoredGraveTrigger.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredGraveTrigger);

    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === carrie.uid)).toMatchObject({ location: "banished", reason: duelReason.effect, reasonPlayer: 0 });
    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === graveA.uid)).toMatchObject({ location: "banished", reason: duelReason.effect, reasonPlayer: 0 });
    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === graveB.uid)).toMatchObject({ location: "banished", reason: duelReason.effect, reasonPlayer: 0 });
    expect(currentAttack(restoredGraveTrigger.session.state.cards.find((card) => card.uid === extraGoldPride.uid), restoredGraveTrigger.session.state)).toBe(3500);
    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === extraGoldPride.uid)).toMatchObject({ attackModifier: 1500 });
    expect(restoredGraveTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName) || (event.eventName === "banished" && event.eventUids === undefined)).map((event) => ({
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
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: carrie.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: extraGoldPride.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previous: "extraDeck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: carrie.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
    ]);
    expect(restoredGraveTrigger.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventUids !== undefined).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveA.uid, eventUids: [graveA.uid, graveB.uid, carrie.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: carrie.uid, eventReasonEffectId: 4, previous: "graveyard", current: "banished" },
    ]);
    expect(restoredGraveTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createCarrieSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 96305350, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [carrieCode, trapCode, graveGoldPrideACode, graveGoldPrideBCode], extra: [extraGoldPrideCode] }, 1: { main: [] } });
  startDuel(session);
  const carrie = requireCard(session, carrieCode);
  const extraGoldPride = requireCard(session, extraGoldPrideCode);
  moveDuelCard(session.state, carrie.uid, "hand", 0);
  moveFaceUpAttack(session, extraGoldPride, 0, 0);
  extraGoldPride.summonType = "synchro";
  extraGoldPride.summonPlayer = 0;
  extraGoldPride.summonPhase = "main1";
  moveDuelCard(session.state, requireCard(session, graveGoldPrideACode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveGoldPrideBCode).uid, "graveyard", 0);
  session.state.players[0].lifePoints = 7000;
  session.state.players[1].lifePoints = 8000;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(carrieCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectCarrieScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return Duel.GetLP(tp)<Duel.GetLP(1-tp)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_GOLD_PRIDE) and c:IsTrap() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e4:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsSetCard(SET_GOLD_PRIDE) and c:IsSummonLocation(LOCATION_EXTRA) and c:IsFaceup()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil,g)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,0,500)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("tc:UpdateAttack(ct*500,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");
}

function cards(): DuelCardData[] {
  return [
    { code: carrieCode, name: "Gold Pride - Captain Carrie", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGoldPride], race: raceFiend, attribute: attributeWater, level: 3, attack: 900, defense: 1700 },
    { code: trapCode, name: "Gold Pride Trap Fixture", kind: "trap", typeFlags: typeTrap, setcodes: [setGoldPride] },
    { code: extraGoldPrideCode, name: "Gold Pride Extra Deck Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [setGoldPride], race: raceWarrior, attribute: attributeLight, level: 6, attack: 2000, defense: 2000 },
    { code: graveGoldPrideACode, name: "Gold Pride Grave Banish A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGoldPride], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: graveGoldPrideBCode, name: "Gold Pride Grave Banish B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGoldPride], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1300, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
