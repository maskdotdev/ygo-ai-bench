import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gutsCode = "7540107";
const allyCode = "75401070";
const searchTargetCode = "75401071";
const offSetDecoyCode = "75401072";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGutsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gutsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setGouki = 0xfc;
const raceWarrior = 0x1;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const effectIndestructibleBattle = 42;
const effectUpdateAttack = 100;
const effectFlagSingleRange = 0x20000;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGutsScript)("Lua real script Gouki Guts defense indestructible boost to-grave search stat", () => {
  it("restores Defense battle indestructibility, Gouki group ATK boost, and to-grave Gouki search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectGutsScriptShape(workspace.readScript(`official/c${gutsCode}.lua`));
    const gutsData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gutsCode);
    expect(gutsData).toBeDefined();
    const reader = createCardReader([
      gutsData!,
      ...fixtureCards(),
    ]);

    const restoredBoost = createRestoredBoostWindow({ reader, workspace });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const guts = requireCard(restoredBoost.session, gutsCode);
    const ally = requireCard(restoredBoost.session, allyCode);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === guts.uid && effect.code === effectIndestructibleBattle).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleBattle, event: "continuous", luaConditionDescriptor: undefined, property: effectFlagSingleRange, range: ["monsterZone"], sourceUid: guts.uid, value: 1 },
    ]);
    expect(destroyDuelCard(restoredBoost.session.state, guts.uid, 0, duelReason.battle | duelReason.destroy, 1)).toMatchObject({
      uid: guts.uid,
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
    });

    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "activateEffect" && action.uid === guts.uid && action.effectId === "lua-2");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === guts.uid), restoredBoost.session.state)).toBe(1000);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === ally.uid), restoredBoost.session.state)).toBe(1400);
    expect(restoredBoost.session.state.effects.filter((effect) => [guts.uid, ally.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: guts.uid, value: 200 },
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: ally.uid, value: 200 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      chainSolvedEvent(2, "chain-3"),
    ]);

    const restoredGraveOpen = createRestoredSearchWindow({ reader, workspace });
    expectCleanRestore(restoredGraveOpen);
    expectRestoredLegalActions(restoredGraveOpen, 0);
    const graveGuts = requireCard(restoredGraveOpen.session, gutsCode);
    const searchTarget = requireCard(restoredGraveOpen.session, searchTargetCode);
    const offSetDecoy = requireCard(restoredGraveOpen.session, offSetDecoyCode);
    sendDuelCardToGraveyard(restoredGraveOpen.session.state, graveGuts.uid, 0, duelReason.effect, 0);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredGraveOpen.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    expect(restoredSearch.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1014", eventCardUid: graveGuts.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: graveGuts.uid, triggerBucket: "turnOptional" },
    ]);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateTrigger" && action.uid === graveGuts.uid && action.effectId === "lua-3-1014");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveGuts.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveGuts.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(searchTarget.uid, graveGuts.uid, 3, 2),
      confirmedEvent(searchTarget.uid, graveGuts.uid, 3, 2),
      sentToHandConfirmedEvent(searchTarget.uid, graveGuts.uid, 3, 2),
      chainSolvedEvent(3, "chain-3"),
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBoostWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7540107, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gutsCode, allyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpDefense(session, requireCard(session, gutsCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerGuts(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7540108, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gutsCode, searchTargetCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gutsCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerGuts(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: allyCode, name: "Gouki Guts Boost Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: searchTargetCode, name: "Gouki Guts Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: offSetDecoyCode, name: "Gouki Guts Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
  ];
}

function registerGuts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gutsCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectGutsScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gouki Guts");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_GOUKI) and c:IsMonster()");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("return c:IsSetCard(SET_GOUKI) and not c:IsCode(id) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function sentToHandEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
