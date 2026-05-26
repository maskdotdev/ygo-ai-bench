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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const archivesCode = "76672730";
const discardCode = "766727300";
const fieldDarkWorldCode = "766727301";
const discardFodderCode = "766727302";
const drawOneCode = "766727303";
const drawTwoCode = "766727304";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setDarkWorld = 0x6;
const raceFiend = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark World Archives discard draw stat", () => {
  it("restores Dark World discard boost into delayed discard draw trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${archivesCode}.lua`);
    expectScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const archivesData = databaseCards.find((card) => card.code === archivesCode);
    expect(archivesData).toBeDefined();
    const reader = createCardReader([
      archivesData!,
      { code: discardCode, name: "Archives Discarded Dark World", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1400, defense: 1000, setcodes: [setDarkWorld] },
      { code: fieldDarkWorldCode, name: "Archives Field Dark World", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1600, defense: 1200, setcodes: [setDarkWorld] },
      { code: discardFodderCode, name: "Archives Trigger Discard Fodder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 3, attack: 900, defense: 900 },
      { code: drawOneCode, name: "Archives Draw One", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: drawTwoCode, name: "Archives Draw Two", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ] satisfies DuelCardData[]);

    const session = createDuel({ seed: 76672730, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [archivesCode, discardCode, fieldDarkWorldCode, discardFodderCode, drawOneCode, drawTwoCode] }, 1: { main: [] } });
    startDuel(session);

    const archives = requireCard(session, archivesCode);
    const discardedDarkWorld = requireCard(session, discardCode);
    const fieldDarkWorld = requireCard(session, fieldDarkWorldCode);
    const discardFodder = requireCard(session, discardFodderCode);
    const drawOne = requireCard(session, drawOneCode);
    const drawTwo = requireCard(session, drawTwoCode);
    moveDuelCard(session.state, archives.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, discardedDarkWorld.uid, "hand", 0);
    moveDuelCard(session.state, discardFodder.uid, "hand", 0);
    moveDuelCard(session.state, drawOne.uid, "deck", 0);
    moveDuelCard(session.state, drawTwo.uid, "deck", 0);
    moveFaceUpAttack(session, fieldDarkWorld, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(archivesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === archives.uid && action.effectId === "lua-2");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === discardedDarkWorld.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: archives.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === fieldDarkWorld.uid), restoredOpen.session.state)).toBe(2000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded" || event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "discarded", eventCardUid: discardedDarkWorld.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: archives.uid, eventReasonEffectId: 2 },
      { eventName: "sentToGraveyard", eventCardUid: discardedDarkWorld.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: archives.uid, eventReasonEffectId: 2 },
    ]);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1018",
        eventCardUid: discardedDarkWorld.uid,
        eventName: "discarded",
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonCardUid: archives.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: archives.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fieldDarkWorld.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, sourceUid: fieldDarkWorld.uid, value: 400 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const drawTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === archives.uid);
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, drawTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === discardFodder.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.discard, reasonCardUid: archives.uid, reasonEffectId: 3 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === drawOne.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === drawTwo.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn").map((event) => ({
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "cardsDrawn", eventPlayer: 0, eventValue: 2, eventUids: [drawOne.uid, drawTwo.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: archives.uid, eventReasonEffectId: 3 },
    ]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === fieldDarkWorld.uid), restoredTrigger.session.state)).toBe(2000);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e2:SetCategory(CATEGORY_HANDES+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(dg,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("local og=Duel.GetOperatedGroup()");
  expect(script).toContain("local atk=og:GetFirst():GetLevel()*100");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EVENT_DISCARD)");
  expect(script).toContain("return eg:IsExists(s.dfilter,1,nil,tp) and (re:GetHandler():IsSetCard(SET_DARK_WORLD) or rp==1-tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsDiscardable,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.Draw(tp,2,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = restored.session.state.waitingFor;
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
