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
const setRyzeal = 0x1b6;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ryzeal Cross Graveyard to Deck bottom draw", () => {
  it("restores Ryzeal Cross's two-target Graveyard bottom-deck return and draw operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crossCode = "6798031";
    const graveACode = "6798032";
    const graveBCode = "6798033";
    const deckFillerCode = "6798034";
    const drawCode = "6798035";
    const responderCode = "6798036";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crossCode),
      { code: graveACode, name: "Ryzeal Cross Graveyard A", kind: "monster", typeFlags: 0x1, level: 4, setcodes: [setRyzeal] },
      { code: graveBCode, name: "Ryzeal Cross Graveyard B", kind: "monster", typeFlags: 0x1, level: 4, setcodes: [setRyzeal] },
      { code: deckFillerCode, name: "Ryzeal Cross Deck Filler", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawCode, name: "Ryzeal Cross Draw Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Ryzeal Cross Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 679, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crossCode, graveACode, graveBCode, deckFillerCode, drawCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const cross = session.state.cards.find((card) => card.code === crossCode);
    const graveA = session.state.cards.find((card) => card.code === graveACode);
    const graveB = session.state.cards.find((card) => card.code === graveBCode);
    const deckFiller = session.state.cards.find((card) => card.code === deckFillerCode);
    const drawCard = session.state.cards.find((card) => card.code === drawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(cross).toBeDefined();
    expect(graveA).toBeDefined();
    expect(graveB).toBeDefined();
    expect(deckFiller).toBeDefined();
    expect(drawCard).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, cross!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, graveA!.uid, "graveyard", 0);
    moveDuelCard(session.state, graveB!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(crossCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const crossAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === cross!.uid);
    expect(crossAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, crossAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-6798032-1",
              "p0-deck-6798033-2",
            ],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-6798031-0",
        "targetFieldIds": [
          8,
          9,
        ],
        "targetUids": [
          "p0-deck-6798032-1",
          "p0-deck-6798033-2",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [graveA!.uid, graveB!.uid], count: 2, player: 0, parameter: 0 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-6798032-1",
              "p0-deck-6798033-2",
            ],
          },
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-6798031-0",
        "targetFieldIds": [
          8,
          9,
        ],
        "targetUids": [
          "p0-deck-6798032-1",
          "p0-deck-6798033-2",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [graveA!.uid, graveB!.uid], count: 2, player: 0, parameter: 0 },
      { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === cross!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === graveA!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === graveB!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === deckFiller!.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "hand", controller: 0, sequence: 0 });
    expect(getCards(restored.session.state, 0, "deck").map((card) => card.uid)).toEqual([deckFiller!.uid, graveA!.uid, graveB!.uid]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveA!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cross!.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveB!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 3, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cross!.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveA!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 2, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cross!.uid,
        eventReasonEffectId: 3,
        eventUids: [graveA!.uid, graveB!.uid],
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawCard!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cross!.uid,
        eventReasonEffectId: 3,
        eventCardUid: drawCard!.uid,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restored.host.messages).not.toContain("ryzeal cross responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("ryzeal cross responder resolved") end)
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
