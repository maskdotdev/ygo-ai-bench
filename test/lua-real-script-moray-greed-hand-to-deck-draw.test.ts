import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const morayCode = "22123627";
const waterACode = "221236270";
const waterBCode = "221236271";
const waterCCode = "221236272";
const drawACode = "221236273";
const drawBCode = "221236274";
const drawCCode = "221236275";
const responderCode = "221236276";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Moray of Greed hand-to-Deck draw", () => {
  it("restores confirmed WATER hand returns into shuffled Deck placement and a three-card draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${morayCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,2,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,3)");
    expect(script).toContain("Duel.ConfirmCards(1-p,sg)");
    expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Draw(p,3,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === morayCode),
      { code: waterACode, name: "Moray WATER A", kind: "monster", typeFlags: typeMonster, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: waterBCode, name: "Moray WATER B", kind: "monster", typeFlags: typeMonster, attribute: attributeWater, level: 4, attack: 1100, defense: 1000 },
      { code: waterCCode, name: "Moray WATER C", kind: "monster", typeFlags: typeMonster, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
      { code: drawACode, name: "Moray Draw A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
      { code: drawBCode, name: "Moray Draw B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: drawCCode, name: "Moray Draw C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Moray Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22123627, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [morayCode, waterACode, waterBCode, waterCCode, drawACode, drawBCode, drawCCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const moray = requireCard(session, morayCode);
    const waterA = requireCard(session, waterACode);
    const waterB = requireCard(session, waterBCode);
    const waterC = requireCard(session, waterCCode);
    const drawA = requireCard(session, drawACode);
    const drawB = requireCard(session, drawBCode);
    const drawC = requireCard(session, drawCCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, moray.uid, "hand", 0);
    moveDuelCard(session.state, waterA.uid, "hand", 0);
    moveDuelCard(session.state, waterB.uid, "hand", 0);
    moveDuelCard(session.state, waterC.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(morayCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === moray.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: moray.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetPlayer: 0,
        operationInfos: [
          { category: 0x10, targetUids: [], count: 2, player: 0, parameter: 0x2 },
          { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 3 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).toEqual([`confirmed 1: ${waterACode},${waterBCode}`]);
    expect(restoredChain.host.messages).not.toContain("moray responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === moray.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterA.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterB.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterC.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === drawA.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === drawB.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === drawC.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["confirmed", "sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: waterA.uid,
        eventPlayer: 1,
        eventValue: 2,
        eventUids: [waterA.uid, waterB.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: waterA.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: waterB.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: waterA.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventUids: [waterA.uid, waterB.uid],
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 3,
        eventUids: [drawA.uid, drawC.uid, waterA.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventCardUid: drawA.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("moray responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
