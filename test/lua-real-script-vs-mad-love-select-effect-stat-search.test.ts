import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const madLoveCode = "29280200";
const searchCode = "292802001";
const darkRevealCode = "292802002";
const opponentTargetCode = "292802003";
const decoySpellCode = "292802004";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const attributeDark = 0x20;
const setVanquishSoul = 0x196;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vanquish Soul Dr. Mad Love SelectEffect stat search", () => {
  it("restores Vanquish Soul SelectEffect reveal branch into stat reduction and summon search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${madLoveCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,0,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("tc:UpdateAttack(-500,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("tc:UpdateDefense(-500,RESET_EVENT|RESETS_STANDARD,c)");

    const statSession = createMadLoveSession();
    const statMadLove = requireCard(statSession, madLoveCode);
    const darkReveal = requireCard(statSession, darkRevealCode);
    const opponentTarget = requireCard(statSession, opponentTargetCode);
    moveDuelCard(statSession.state, statMadLove.uid, "monsterZone", 0).position = "faceUpAttack";
    statMadLove.faceUp = true;
    moveDuelCard(statSession.state, darkReveal.uid, "hand", 0);
    moveDuelCard(statSession.state, opponentTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentTarget.faceUp = true;
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;

    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(madLoveCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, statSession.cardReader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === statMadLove.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, statAction!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [468483202], returned: 1 },
    ]);
    expect(restoredOpen.host.messages).toContain(`confirmed 1: ${darkRevealCode}`);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredOpen.session.state)).toBe(1300);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredOpen.session.state)).toBe(1100);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: darkReveal.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventUids: [darkReveal.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const searchSession = createMadLoveSession();
    const searchMadLove = requireCard(searchSession, madLoveCode);
    const searched = requireCard(searchSession, searchCode);
    moveDuelCard(searchSession.state, searchMadLove.uid, "hand", 0);
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;

    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(madLoveCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const summon = getLegalActions(searchSession, 0).find((action) => action.type === "normalSummon" && action.uid === searchMadLove.uid);
    expect(summon, JSON.stringify(getLegalActions(searchSession, 0), null, 2)).toBeDefined();
    applyAndAssert(searchSession, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, searchSession.cardReader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: searchMadLove.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: searchMadLove.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === searchMadLove.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.chain).toEqual([]);
    expect(restoredTriggerWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === searched.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchMadLove.uid,
      reasonEffectId: 1,
    });
    expect(restoredTriggerWindow.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searched.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchMadLove.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searched.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchMadLove.uid,
        eventReasonEffectId: 1,
        eventValue: 1,
        eventUids: [searched.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: searched.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchMadLove.uid,
        eventReasonEffectId: 1,
        eventValue: 1,
        eventUids: [searched.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function createMadLoveSession(): DuelSession {
  const cards: DuelCardData[] = [
    { code: madLoveCode, name: "Vanquish Soul Dr. Mad Love", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVanquishSoul], attribute: attributeDark, level: 4, attack: 1200, defense: 2000 },
    { code: searchCode, name: "Vanquish Soul Search Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setVanquishSoul] },
    { code: darkRevealCode, name: "Vanquish Soul DARK Reveal", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Vanquish Soul Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1600 },
    { code: decoySpellCode, name: "Vanquish Soul Decoy Spell", kind: "spell", typeFlags: typeSpell },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 29280200, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [madLoveCode, searchCode, darkRevealCode, decoySpellCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  return session;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
