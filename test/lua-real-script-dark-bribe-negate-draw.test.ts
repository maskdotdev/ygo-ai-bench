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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Bribe negate draw", () => {
  it("restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkBribeCode = "77538567";
    const upstartCode = "70368879";
    const drawnCode = "923";
    const responderCode = "924";
    const script = workspace.readScript(`c${darkBribeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_DRAW)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,1-tp,1)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [darkBribeCode, upstartCode].includes(card.code)),
      { code: drawnCode, name: "Dark Bribe Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Dark Bribe Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 476, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [upstartCode, drawnCode, responderCode] }, 1: { main: [darkBribeCode] } });
    startDuel(session);

    const upstart = session.state.cards.find((card) => card.code === upstartCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const darkBribe = session.state.cards.find((card) => card.code === darkBribeCode);
    expect(upstart).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(darkBribe).toBeDefined();
    moveDuelCard(session.state, upstart!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, darkBribe!.uid, "spellTrapZone", 1);
    darkBribe!.position = "faceDown";
    darkBribe!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(upstartCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(darkBribeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const upstartAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === upstart!.uid);
    expect(upstartAction).toBeDefined();
    applyAndAssert(session, upstartAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]!.operationInfos).toContainEqual({ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 });
    expect(session.state.chain[0]!.operationInfos).toContainEqual(expect.objectContaining({ category: 65536, player: 0, parameter: 1 }));

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpenChain, 1);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    const darkBribeAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === darkBribe!.uid);
    expect(darkBribeAction).toBeDefined();
    expect(restoredOpenChain.session.state.chain[0]!.operationInfos).toContainEqual({ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 });
    expect({ category: 0x10000000, targetUids: [upstart!.uid], count: 1, player: 0, parameter: 0 }).toMatchObject({
      category: 0x10000000,
      count: 1,
      player: 0,
      parameter: 0,
    });
    const chained = applyLuaRestoreResponse(restoredOpenChain, darkBribeAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === upstart!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === darkBribe!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredOpenChain.host.messages).not.toContain("dark bribe chain responder resolved");
    expect(
      restoredOpenChain.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn", "chainNegated", "chainDisabled"].includes(event.eventName)),
    ).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: upstart!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: darkBribe!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawn!.uid],
        eventCardUid: drawn!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: darkBribe!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "deck", sequence: 2, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([]);
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("dark bribe chain responder resolved") end)
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
  return response;
}
