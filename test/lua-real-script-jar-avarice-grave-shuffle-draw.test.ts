import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Jar of Avarice grave shuffle draw", () => {
  it("restores Jar of Avarice's five Graveyard targets, Deck shuffle, BreakEffect, and draw operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jarCode = "98954106";
    const graveCodes = ["98954107", "98954108", "98954109", "98954110", "98954111"];
    const drawCode = "98954112";
    const responderCode = "98954113";
    const script = workspace.readScript(`c${jarCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,5,5,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,5,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.SendtoDeck(tg,nil,SEQ_DECKTOP,REASON_EFFECT)");
    expect(script).toContain("Duel.GetOperatedGroup()");
    expect(script).toContain("Duel.ShuffleDeck(tp)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === jarCode),
      ...graveCodes.map((code, index) => ({
        code,
        name: `Jar of Avarice Graveyard Card ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000 + index,
        defense: 1000,
      })),
      { code: drawCode, name: "Jar of Avarice Existing Deck Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Jar of Avarice Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 98954106, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jarCode, ...graveCodes, drawCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const jar = requireCard(session, jarCode);
    const graveCards = graveCodes.map((code) => requireCard(session, code));
    const drawCard = requireCard(session, drawCode);
    const responder = requireCard(session, responderCode);
    const movedJar = moveDuelCard(session.state, jar.uid, "spellTrapZone", 0);
    movedJar.position = "faceDown";
    movedJar.faceUp = false;
    for (const card of graveCards) moveDuelCard(session.state, card.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jarCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const activation = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === jar.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, activation!);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: jar.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [10, 11, 12, 13, 14],
        targetUids: graveCards.map((card) => card.uid),
        operationInfos: [
          { category: 0x10, targetUids: graveCards.map((card) => card.uid), count: 5, player: 0, parameter: 0 },
          { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
        ],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.chain).toEqual(restoredOpenWindow.session.state.chain);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === jar.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === graveCards[0]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === graveCards[1]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === graveCards[2]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === graveCards[3]!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === graveCards[4]!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.host.messages).not.toContain("jar avarice responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[1]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[2]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 3 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[3]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 4 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[4]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 5 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveCards[0]!.uid,
        eventUids: graveCards.map((card) => card.uid),
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 4 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [graveCards[3]!.uid],
        eventCardUid: graveCards[3]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jar.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("jar avarice responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
