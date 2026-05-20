import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeFusion } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const wingmanCode = "87758525";
const hasWingmanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wingmanCode}.lua`));
const graveCodes = ["877585250", "877585251", "877585252", "877585253", "877585254"];
const drawCodes = ["877585255", "877585256"];
const battleTargetCode = "877585257";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasWingmanScript)("Lua real script Favorite HERO Shining Flare Wingman shuffle draw burn", () => {
  it("restores Extra Deck summon shuffle-draw attack gain and battle-destroying damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wingmanCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_FUSION),s.matfilter)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK|CATEGORY_DRAW|CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsSummonLocation(LOCATION_EXTRA)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.tdfilter,tp,LOCATION_GRAVE,0,5,nil)");
    expect(script).toContain("Duel.IsPlayerCanDraw(tp,2)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,5,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,2)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tdfilter,tp,LOCATION_GRAVE,0,5,5,nil)");
    expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
    expect(script).toContain("Duel.GetOperatedGroup():IsExists(Card.IsLocation,1,nil,LOCATION_DECK)");
    expect(script).toContain("Duel.ShuffleDeck(tp)");
    expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)==2");
    expect(script).toContain("c:UpdateAttack(1000)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("local dam=e:GetHandler():GetBattleTarget():GetBaseAttack()");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: wingmanCode, name: "Favorite HERO Shining Flare Wingman", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 8, attack: 2500, defense: 2100 },
      ...graveCodes.map((code, index) => ({
        code,
        name: `Favorite HERO Grave Monster ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000 + index,
        defense: 1000,
      })),
      ...drawCodes.map((code, index) => ({
        code,
        name: `Favorite HERO Draw Card ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1500 + index,
        defense: 1200,
      })),
      { code: battleTargetCode, name: "Favorite HERO Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 87758525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [...graveCodes, ...drawCodes], extra: [wingmanCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const wingman = requireCard(session, wingmanCode);
    const graveCards = graveCodes.map((code) => requireCard(session, code));
    const drawCards = drawCodes.map((code) => requireCard(session, code));
    const battleTarget = requireCard(session, battleTargetCode);
    for (const card of graveCards) moveDuelCard(session.state, card.uid, "graveyard", 0);
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    battleTarget.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wingmanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, wingman.uid, 0, 0, {}, luaSummonTypeFusion, true, true);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: wingman.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        player: 0,
        sourceUid: wingman.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === wingman.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === wingman.uid), restoredTrigger.session.state)).toBe(3500);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    expect(restoredTrigger.session.state.cards.filter((card) => drawCards.some((draw) => draw.uid === card.uid) && card.location === "hand")).toHaveLength(2);
    expect(restoredTrigger.session.state.cards.filter((card) => graveCards.some((grave) => grave.uid === card.uid) && card.location === "deck")).toHaveLength(5);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[1]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 3 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[2]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 4 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[3]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 5 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[4]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 6 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventUids: graveCards.map((card) => card.uid),
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 4 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [drawCards[1]!.uid, drawCards[0]!.uid],
        eventCardUid: drawCards[1]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    restoredTrigger.session.state.phase = "battle";
    restoredTrigger.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === wingman.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, attack!);
    passRestoredBattleResponses(restoredTrigger);

    const restoredBattleDestroying = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattleDestroying);
    expectRestoredLegalActions(restoredBattleDestroying, 0);
    const burnTrigger = getLuaRestoreLegalActions(restoredBattleDestroying, 0).find((action) => action.type === "activateTrigger" && action.uid === wingman.uid);
    expect(burnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleDestroying, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleDestroying, burnTrigger!);
    expect(restoredBattleDestroying.session.state.players[1].lifePoints).toBe(4500);
    expect(restoredBattleDestroying.session.state.eventHistory.filter((event) => ["battleDestroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingman.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
