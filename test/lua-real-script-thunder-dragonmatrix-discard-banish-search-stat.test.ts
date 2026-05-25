import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragonmatrixCode = "20318029";
const thunderTargetCode = "203180290";
const nonThunderCode = "203180291";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDragonmatrixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonmatrixCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceThunder = 0x1000;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDragonmatrixScript)("Lua real script Thunder Dragonmatrix discard banish search stat", () => {
  it("restores hand self-discard Thunder ATK gain and banished Deck search confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonmatrixCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const handDragonmatrix = requireCard(restoredOpen.session, dragonmatrixCode, "hand");
    const thunderTarget = requireCard(restoredOpen.session, thunderTargetCode, "monsterZone");
    const nonThunder = requireCard(restoredOpen.session, nonThunderCode, "monsterZone");

    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === handDragonmatrix.uid && action.effectId === "lua-1-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === handDragonmatrix.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handDragonmatrix.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === thunderTarget.uid), restoredOpen.session.state)).toBe(2100);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === nonThunder.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handDragonmatrix.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handDragonmatrix.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: thunderTarget.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredSearchOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredSearchOpen);
    expectRestoredLegalActions(restoredSearchOpen, 0);
    const banishedDragonmatrix = requireCard(restoredSearchOpen.session, dragonmatrixCode, "hand");
    const searchDeckDragonmatrix = requireCard(restoredSearchOpen.session, dragonmatrixCode, "deck");
    banishDuelCard(restoredSearchOpen.session.state, banishedDragonmatrix.uid, 0, duelReason.effect, 0);
    const restoredBanished = restoreDuelWithLuaScripts(serializeDuel(restoredSearchOpen.session), workspace, reader);
    expectCleanRestore(restoredBanished);
    expectRestoredLegalActions(restoredBanished, 0);
    expect(restoredBanished.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1011", eventCode: 1011, eventName: "banished", player: 0, sourceUid: banishedDragonmatrix.uid, triggerBucket: "turnOptional" },
    ]);
    const search = getLuaRestoreLegalActions(restoredBanished, 0).find((action) => action.type === "activateTrigger" && action.uid === banishedDragonmatrix.uid && action.effectId === "lua-2-1011");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredBanished, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanished, search!);
    passRestoredChain(restoredBanished);

    expect(restoredBanished.session.state.cards.find((card) => card.uid === searchDeckDragonmatrix.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: banishedDragonmatrix.uid,
      reasonEffectId: 2,
    });
    expect(restoredBanished.host.messages).toContain(`confirmed 1: ${dragonmatrixCode}`);
    expect(restoredBanished.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: banishedDragonmatrix.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: searchDeckDragonmatrix.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: banishedDragonmatrix.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: searchDeckDragonmatrix.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: banishedDragonmatrix.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: searchDeckDragonmatrix.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: banishedDragonmatrix.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(restoredBanished.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 20318029, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dragonmatrixCode, dragonmatrixCode, thunderTargetCode, nonThunderCode] }, 1: { main: [] } });
  startDuel(session);
  const handDragonmatrix = requireCard(session, dragonmatrixCode, "deck");
  const deckDragonmatrix = session.state.cards.find((card) => card.code === dragonmatrixCode && card.uid !== handDragonmatrix.uid);
  expect(deckDragonmatrix).toBeDefined();
  moveDuelCard(session.state, handDragonmatrix.uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, thunderTargetCode, "deck"), 0, 0);
  moveFaceUpAttack(session, requireCard(session, nonThunderCode, "deck"), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonmatrixCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dragonmatrix = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dragonmatrixCode);
  expect(dragonmatrix).toBeDefined();
  return [
    dragonmatrix!,
    { code: thunderTargetCode, name: "Thunder Dragonmatrix Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: nonThunderCode, name: "Thunder Dragonmatrix Non-Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Thunder Dragonmatrix");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.IsExistingTarget(aux.FaceupFilter(Card.IsRace,RACE_THUNDER),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_THUNDER),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("tc:UpdateAttack(500,nil,e:GetHandler())");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e3:SetCondition(function(e) return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD) end)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function requireCard(session: DuelSession, code: string, location?: DuelCardInstance["location"]): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (location === undefined || candidate.location === location));
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
