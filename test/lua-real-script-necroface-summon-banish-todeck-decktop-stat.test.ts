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
const necrofaceCode = "28297833";
const banishedACode = "282978330";
const banishedBCode = "282978331";
const p0DeckCodes = ["282978332", "282978333", "282978334", "282978335", "282978336"] as const;
const p1DeckCodes = ["282978337", "282978338", "282978339", "282978340", "282978341"] as const;
const decktopBanishEventCodes = [p0DeckCodes[4], p0DeckCodes[0], p0DeckCodes[2], p0DeckCodes[3], p0DeckCodes[1], p1DeckCodes[4], p1DeckCodes[0], p1DeckCodes[1], p1DeckCodes[3], p1DeckCodes[2], p0DeckCodes[4]] as const;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNecrofaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${necrofaceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasNecrofaceScript)("Lua real script Necroface summon banish todeck decktop stat", () => {
  it("restores Normal Summon banished-card shuffle ATK gain and banished Deck-top removal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${necrofaceCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummonOpen = createRestoredSummonField({ reader, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonNecroface = requireCard(restoredSummonOpen.session, necrofaceCode);
    const banishedA = requireCard(restoredSummonOpen.session, banishedACode);
    const banishedB = requireCard(restoredSummonOpen.session, banishedBCode);
    const normalSummon = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summonNecroface.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, normalSummon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const toDeck = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonNecroface.uid);
    expect(toDeck, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, toDeck!);
    resolveRestoredChain(restoredSummonTrigger);

    for (const returned of [banishedA, banishedB]) {
      expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === returned.uid)).toMatchObject({
        location: "deck",
        controller: returned.controller,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: summonNecroface.uid,
        reasonEffectId: 1,
      });
    }
    expect(currentAttack(restoredSummonTrigger.session.state.cards.find((card) => card.uid === summonNecroface.uid), restoredSummonTrigger.session.state)).toBe(1400);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === summonNecroface.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: summonNecroface.uid, value: 200 },
    ]);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
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
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: banishedA.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonNecroface.uid, eventReasonEffectId: 1, previous: "banished", current: "deck" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: banishedB.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonNecroface.uid, eventReasonEffectId: 1, previous: "banished", current: "deck" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: banishedA.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonNecroface.uid, eventReasonEffectId: 1, previous: "banished", current: "deck" },
    ]);

    const restoredRemoveOpen = createRestoredRemoveField({ reader, workspace });
    expectCleanRestore(restoredRemoveOpen);
    expectRestoredLegalActions(restoredRemoveOpen, 0);
    const removeNecroface = requireCard(restoredRemoveOpen.session, necrofaceCode);
    banishDuelCard(restoredRemoveOpen.session.state, removeNecroface.uid, 0, duelReason.effect, 1);
    const restoredRemoveTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredRemoveOpen.session), workspace, reader);
    expectCleanRestore(restoredRemoveTrigger);
    expectRestoredLegalActions(restoredRemoveTrigger, 0);
    const removeDeckTop = getLuaRestoreLegalActions(restoredRemoveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === removeNecroface.uid);
    expect(removeDeckTop, JSON.stringify(getLuaRestoreLegalActions(restoredRemoveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemoveTrigger, removeDeckTop!);
    resolveRestoredChain(restoredRemoveTrigger);

    for (const code of [...p0DeckCodes, ...p1DeckCodes]) {
      const removed = requireCard(restoredRemoveTrigger.session, code);
      expect(removed).toMatchObject({
        location: "banished",
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: removeNecroface.uid,
        reasonEffectId: 2,
      });
    }
    expect(currentAttack(restoredRemoveTrigger.session.state.cards.find((card) => card.uid === removeNecroface.uid), restoredRemoveTrigger.session.state)).toBe(1700);
    expect(restoredRemoveTrigger.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: removeNecroface.uid, eventReason: duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "banished" },
      ...decktopBanishEventCodes.map((code) => {
        const removed = requireCard(restoredRemoveTrigger.session, code);
        return { eventName: "banished", eventCode: 1011, eventCardUid: removed.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeNecroface.uid, eventReasonEffectId: 2, previous: "deck", current: "banished" };
      }),
    ]);
    expect(restoredRemoveTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 28297833, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [necrofaceCode, banishedACode] }, 1: { main: [banishedBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, necrofaceCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, banishedACode).uid, "banished", 0);
  moveDuelCard(session.state, requireCard(session, banishedBCode).uid, "banished", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(necrofaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredRemoveField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 282978330, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [necrofaceCode, ...p0DeckCodes] }, 1: { main: [...p1DeckCodes] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, necrofaceCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(necrofaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Necroface");
  expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_REMOVED,LOCATION_REMOVED)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("g:FilterCount(Card.IsLocation,nil,LOCATION_DECK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*100)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.GetDecktopGroup(tp,5)");
  expect(script).toContain("Duel.GetDecktopGroup(1-tp,5)");
  expect(script).toContain("Duel.DisableShuffleCheck()");
  expect(script).toContain("Duel.Remove(g1,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetValue(500)");
}

function cards(): DuelCardData[] {
  const monster = (code: string, name: string): DuelCardData => ({
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceZombie,
    attribute: attributeDark,
    level: 4,
    attack: code === necrofaceCode ? 1200 : 800,
    defense: code === necrofaceCode ? 1800 : 800,
  });
  return [
    monster(necrofaceCode, "Necroface"),
    monster(banishedACode, "Necroface Banished A"),
    monster(banishedBCode, "Necroface Banished B"),
    ...p0DeckCodes.map((code, index) => monster(code, `Necroface P0 Deck ${index + 1}`)),
    ...p1DeckCodes.map((code, index) => monster(code, `Necroface P1 Deck ${index + 1}`)),
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
