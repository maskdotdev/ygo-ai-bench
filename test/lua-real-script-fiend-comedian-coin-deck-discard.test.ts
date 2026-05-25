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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const fiendComedianCode = "81172176";
const ownDeckACode = "811721760";
const ownDeckBCode = "811721761";
const opponentGraveACode = "811721762";
const opponentGraveBCode = "811721763";
const hasFiendComedianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fiendComedianCode}.lua`));
const typeMonster = 0x1;
const categoryRemove = 0x4;
const categoryDeckDes = 0x40;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFiendComedianScript)("Lua real script Fiend Comedian coin deck discard", () => {
  it("restores tails CallCoin into deck discard equal to opponent Graveyard count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fiendComedianCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fiendComedianCode, ownDeckACode, ownDeckBCode] }, 1: { main: [opponentGraveACode, opponentGraveBCode] } });
    startDuel(session);

    const fiendComedian = requireCard(session, fiendComedianCode);
    const ownDeckA = requireCard(session, ownDeckACode);
    const ownDeckB = requireCard(session, ownDeckBCode);
    const opponentGraveA = requireCard(session, opponentGraveACode);
    const opponentGraveB = requireCard(session, opponentGraveBCode);
    const setFiendComedian = moveDuelCard(session.state, fiendComedian.uid, "spellTrapZone", 0);
    setFiendComedian.sequence = 0;
    setFiendComedian.faceUp = false;
    setFiendComedian.position = "faceDown";
    moveDuelCard(session.state, opponentGraveA.uid, "graveyard", 1).faceUp = true;
    moveDuelCard(session.state, opponentGraveB.uid, "graveyard", 1).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const previousStates = new Map([ownDeckA.uid, ownDeckB.uid].map((uid) => [uid, cardEventState(requireCardByUid(session, uid))]));
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fiendComedianCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fiendComedian.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
    }))).toEqual([
      { category: categoryCoin | categoryRemove | categoryDeckDes, code: 1002, countLimit: undefined, event: "quick" },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fiendComedian.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([0]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fiendComedian.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownDeckA.uid)).toMatchObject(discardedDeckCard(ownDeckA.uid, fiendComedian.uid));
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownDeckB.uid)).toMatchObject(discardedDeckCard(ownDeckB.uid, fiendComedian.uid));
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentGraveA.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentGraveB.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "discarded"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fiendComedian.uid,
        eventReasonEffectId: 1,
      },
      {
        ...discardedEvent(ownDeckA.uid, fiendComedian.uid, previousStates.get(ownDeckA.uid)!),
        eventUids: [ownDeckA.uid, ownDeckB.uid],
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Fiend Comedian");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_REMOVE+CATEGORY_DECKDES)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return c:IsAbleToRemove() and aux.SpElimFilter(c)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.rmfilter,tp,0,LOCATION_MZONE|LOCATION_GRAVE,1,nil)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>=Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,nil,1,1-tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DECKDES,nil,1,tp,0)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.Remove(Duel.GetMatchingGroup(s.rmfilter,tp,0,LOCATION_MZONE|LOCATION_GRAVE,nil),POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.DiscardDeck(tp,Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE),REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const fiendComedian = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === fiendComedianCode);
  expect(fiendComedian).toBeDefined();
  return [
    fiendComedian!,
    { code: ownDeckACode, name: "Fiend Comedian Deck A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: ownDeckBCode, name: "Fiend Comedian Deck B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
    { code: opponentGraveACode, name: "Fiend Comedian Opponent Grave A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: opponentGraveBCode, name: "Fiend Comedian Opponent Grave B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
  ];
}

function discardedDeckCard(cardUid: string, sourceUid: string) {
  return {
    uid: cardUid,
    location: "graveyard",
    controller: 0,
    reason: duelReason.effect,
    reasonPlayer: 0,
    reasonCardUid: sourceUid,
    reasonEffectId: 1,
  };
}

function discardedEvent(cardUid: string, sourceUid: string, previousState: ReturnType<typeof cardEventState>) {
  return {
    eventName: "discarded",
    eventCode: 1018,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: previousState,
    eventCurrentState: { ...previousState, faceUp: true, location: "graveyard" },
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCardByUid(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
