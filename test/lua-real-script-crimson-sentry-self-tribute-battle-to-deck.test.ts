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
const sentryCode = "28358902";
const hasSentryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sentryCode}.lua`));
const battleTargetCode = "28358903";
const oldBattleDecoyCode = "28358904";
const effectDecoyCode = "28358905";
const deckFillerCode = "28358906";
const responderCode = "28358907";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSentryScript)("Lua real script Crimson Sentry self-tribute battle to Deck", () => {
  it("restores SelfTribute cost into current-turn battle-reason Graveyard target sent to Deck bottom", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${sentryCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(script).toContain("return c:IsMonster() and c:GetTurnID()==tid and c:IsReason(REASON_BATTLE) and c:IsAbleToDeck()");
    expect(script).toContain("local tid=Duel.GetTurnCount()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,tid)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKBOTTOM,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: sentryCode, name: "Crimson Sentry", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200 },
      { code: battleTargetCode, name: "Crimson Sentry Current Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
      { code: oldBattleDecoyCode, name: "Crimson Sentry Old Battle Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: effectDecoyCode, name: "Crimson Sentry Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1000 },
      { code: deckFillerCode, name: "Crimson Sentry Deck Filler", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Crimson Sentry Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28358902, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sentryCode, battleTargetCode, oldBattleDecoyCode, effectDecoyCode, deckFillerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const sentry = requireCard(session, sentryCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const oldBattleDecoy = requireCard(session, oldBattleDecoyCode);
    const effectDecoy = requireCard(session, effectDecoyCode);
    const deckFiller = requireCard(session, deckFillerCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpMonster(session, sentry.uid, 0, 0);
    moveDuelCard(session.state, battleTarget.uid, "graveyard", 0, duelReason.battle, 1).turnId = session.state.turn;
    moveDuelCard(session.state, oldBattleDecoy.uid, "graveyard", 0, duelReason.battle, 1).turnId = session.state.turn - 1;
    moveDuelCard(session.state, effectDecoy.uid, "graveyard", 0, duelReason.effect, 0).turnId = session.state.turn;
    moveDuelCard(session.state, deckFiller.uid, "deck", 0);
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
    expect(host.loadCardScript(Number(sentryCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sentry.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sentry.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: sentry.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: sentry.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [8],
        targetUids: [battleTarget.uid],
        operationInfos: [{ category: 0x10, targetUids: [battleTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.host.messages).not.toContain("crimson sentry responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 1,
      reason: duelReason.effect,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckFiller.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === oldBattleDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === effectDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: sentry.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: sentry.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 3 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: battleTarget.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sentry.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpMonster(session: DuelSession, uid: string, controller: PlayerId, sequence: number): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
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
      e:SetOperation(function(e,tp) Debug.Message("crimson sentry responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
