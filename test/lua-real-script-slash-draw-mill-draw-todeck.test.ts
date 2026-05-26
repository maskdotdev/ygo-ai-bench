import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const slashDrawCode = "71344451";
const discardCostCode = "713444510";
const milledCode = "713444511";
const drawnCode = "713444512";
const opponentFieldCode = "713444513";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSlashDrawScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slashDrawCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSlashDrawScript)("Lua real script Slash Draw mill draw to-Deck", () => {
  it("restores discard cost, opponent-field-count mill, draw confirm, and fallback Graveyard return to Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${slashDrawCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 71344451, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slashDrawCode, discardCostCode, milledCode, drawnCode] }, 1: { main: [opponentFieldCode] } });
    startDuel(session);

    const slashDraw = requireCard(session, slashDrawCode);
    const discardCost = requireCard(session, discardCostCode);
    const milled = requireCard(session, milledCode);
    const drawn = requireCard(session, drawnCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveDuelCard(session.state, slashDraw.uid, "hand", 0);
    moveDuelCard(session.state, discardCost.uid, "hand", 0);
    moveFaceUpAttack(session, opponentField, 1, 0);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slashDrawCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, slashDraw.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(findCard(restoredOpen.session, slashDraw.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(findCard(restoredOpen.session, discardCost.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(findCard(restoredOpen.session, drawn.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(findCard(restoredOpen.session, milled.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "cardsDrawn", "confirmed", "sentToDeck"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discardCost.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: slashDraw.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discardCost.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: slashDraw.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: milled.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: slashDraw.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "cardsDrawn", eventCode: 1110, eventCardUid: drawn.uid, eventPlayer: 0, eventValue: 1, eventUids: [drawn.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: slashDraw.uid, eventReasonEffectId: 1, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: drawn.uid, eventPlayer: 1, eventValue: 1, eventUids: [drawn.uid], eventReason: 1024, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: discardCost.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: slashDraw.uid, eventReasonEffectId: 1, previous: "graveyard", current: "deck" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: slashDraw.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const slashDraw = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === slashDrawCode);
  expect(slashDraw).toBeDefined();
  return [
    slashDraw!,
    monster(discardCostCode, "Slash Draw Discard Cost"),
    monster(milledCode, "Slash Draw Milled Card"),
    monster(drawnCode, "Slash Draw Non-Slash Draw"),
    monster(opponentFieldCode, "Slash Draw Opponent Field"),
  ];
}

function monster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1200, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Slash Draw");
  expect(script).toContain("e1:SetCategory(CATEGORY_DECKDES+CATEGORY_DRAW+CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_TODECK)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("local ct=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,ct)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.DiscardDeck(tp,ct,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_GRAVE)");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(Card.IsAbleToDeck),tp,LOCATION_GRAVE,0,grave_ct,grave_ct,nil)");
  expect(script).toContain("Duel.SendtoDeck(dg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
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
