import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Trade-In discard draw", () => {
  it("restores Trade-In's Level 8 discard cost, target-player draw metadata, and draw-two resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tradeInCode = "38120068";
    const level8CostCode = "38120069";
    const lowLevelDecoyCode = "38120070";
    const firstDrawCode = "38120071";
    const secondDrawCode = "38120072";
    const responderCode = "38120073";
    const script = workspace.readScript(`official/c${tradeInCode}.lua`);
    expect(script).toContain("Duel.DiscardHand(tp,s.filter,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(2)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tradeInCode),
      { code: level8CostCode, name: "Trade-In Level 8 Cost", kind: "monster", typeFlags: 0x1, level: 8 },
      { code: lowLevelDecoyCode, name: "Trade-In Low Level Decoy", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: firstDrawCode, name: "Trade-In First Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: secondDrawCode, name: "Trade-In Second Draw", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Trade-In Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 381, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tradeInCode, level8CostCode, lowLevelDecoyCode, firstDrawCode, secondDrawCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tradeIn = session.state.cards.find((card) => card.code === tradeInCode);
    const level8Cost = session.state.cards.find((card) => card.code === level8CostCode);
    const lowLevelDecoy = session.state.cards.find((card) => card.code === lowLevelDecoyCode);
    const firstDraw = session.state.cards.find((card) => card.code === firstDrawCode);
    const secondDraw = session.state.cards.find((card) => card.code === secondDrawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(tradeIn).toBeDefined();
    expect(level8Cost).toBeDefined();
    expect(lowLevelDecoy).toBeDefined();
    expect(firstDraw).toBeDefined();
    expect(secondDraw).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, tradeIn!.uid, "hand", 0);
    moveDuelCard(session.state, level8Cost!.uid, "hand", 0);
    moveDuelCard(session.state, lowLevelDecoy!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tradeInCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const tradeInAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === tradeIn!.uid);
    expect(tradeInAction).toBeDefined();
    applyAndAssert(session, tradeInAction!);
    expect(session.state.cards.find((card) => card.uid === level8Cost!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === lowLevelDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        player: 0,
        sourceUid: tradeIn!.uid,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        targetPlayer: 0,
        targetParam: 2,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 }],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toEqual(session.state.chain);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === tradeIn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === level8Cost!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === lowLevelDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === firstDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === secondDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["discarded", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: level8Cost!.uid,
        eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: tradeIn!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [secondDraw!.uid, firstDraw!.uid],
        eventCardUid: secondDraw!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tradeIn!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("trade-in responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("trade-in responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
