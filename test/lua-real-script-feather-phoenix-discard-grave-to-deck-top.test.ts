import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script A Feather of the Phoenix discard Graveyard to Deck top", () => {
  it("restores A Feather of the Phoenix's discard cost, Graveyard target, and Deck-top return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const featherCode = "49140998";
    const discardCode = "49140999";
    const graveTargetCode = "49141000";
    const deckFillerCode = "49141001";
    const responderCode = "49141002";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === featherCode),
      { code: discardCode, name: "Feather of the Phoenix Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: graveTargetCode, name: "Feather of the Phoenix Graveyard Target", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: deckFillerCode, name: "Feather of the Phoenix Deck Filler", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Feather of the Phoenix Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 491, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [featherCode, discardCode, graveTargetCode, deckFillerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const feather = session.state.cards.find((card) => card.code === featherCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const graveTarget = session.state.cards.find((card) => card.code === graveTargetCode);
    const deckFiller = session.state.cards.find((card) => card.code === deckFillerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(feather).toBeDefined();
    expect(discard).toBeDefined();
    expect(graveTarget).toBeDefined();
    expect(deckFiller).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, feather!.uid, "hand", 0);
    moveDuelCard(session.state, discard!.uid, "hand", 0);
    moveDuelCard(session.state, graveTarget!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(featherCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const featherAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === feather!.uid);
    expect(featherAction).toBeDefined();
    applyAndAssert(session, featherAction!);
    expect(session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    const discardEvent = {
      eventName: "discarded",
      eventCode: 1018,
      eventCardUid: discard!.uid,
      eventReason: duelReason.cost | duelReason.discard,
      eventReasonPlayer: 0,
      eventReasonCardUid: feather!.uid,
      eventReasonEffectId: 1,
      eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
    };
    expect(session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 16,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-49141000-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-49140998-0",
        "targetUids": [
          "p0-deck-49141000-2",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 16,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-49141000-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-49140998-0",
        "targetUids": [
          "p0-deck-49141000-2",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === feather!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === graveTarget!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === deckFiller!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 1 });
    expect(getCards(restored.session.state, 0, "deck").map((card) => card.uid)).toEqual([graveTarget!.uid, deckFiller!.uid]);
    expect(restored.session.state.eventHistory.filter((event) => ["discarded", "sentToDeck"].includes(event.eventName))).toEqual([
      discardEvent,
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveTarget!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: feather!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("feather phoenix responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("feather phoenix responder resolved") end)
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
