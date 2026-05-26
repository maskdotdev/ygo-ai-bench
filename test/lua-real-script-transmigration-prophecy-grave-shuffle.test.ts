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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The Transmigration Prophecy Graveyard shuffle", () => {
  it("restores The Transmigration Prophecy's cross-player Graveyard targets and Deck shuffle return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const prophecyCode = "46652477";
    const ownGraveCode = "46652478";
    const opponentGraveCode = "46652479";
    const ownDeckCode = "46652480";
    const opponentDeckCode = "46652481";
    const responderCode = "46652482";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === prophecyCode),
      { code: ownGraveCode, name: "Transmigration Own Graveyard Target", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentGraveCode, name: "Transmigration Opponent Graveyard Target", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ownDeckCode, name: "Transmigration Own Deck Filler", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDeckCode, name: "Transmigration Opponent Deck Filler", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Transmigration Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 466, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [prophecyCode, ownGraveCode, ownDeckCode] },
      1: { main: [opponentGraveCode, opponentDeckCode, responderCode] },
    });
    startDuel(session);

    const prophecy = session.state.cards.find((card) => card.code === prophecyCode);
    const ownGrave = session.state.cards.find((card) => card.code === ownGraveCode);
    const opponentGrave = session.state.cards.find((card) => card.code === opponentGraveCode);
    const ownDeck = session.state.cards.find((card) => card.code === ownDeckCode);
    const opponentDeck = session.state.cards.find((card) => card.code === opponentDeckCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(prophecy).toBeDefined();
    expect(ownGrave).toBeDefined();
    expect(opponentGrave).toBeDefined();
    expect(ownDeck).toBeDefined();
    expect(opponentDeck).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, prophecy!.uid, "spellTrapZone", 0);
    prophecy!.position = "faceDown";
    prophecy!.faceUp = false;
    moveDuelCard(session.state, ownGrave!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentGrave!.uid, "graveyard", 1);
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
    expect(host.loadCardScript(Number(prophecyCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const prophecyAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === prophecy!.uid);
    expect(prophecyAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, prophecyAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-46652478-1",
              "p1-deck-46652479-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-46652477-0",
        "targetFieldIds": [
          8,
          9,
        ],
        "targetUids": [
          "p0-deck-46652478-1",
          "p1-deck-46652479-0",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [ownGrave!.uid, opponentGrave!.uid], count: 2, player: 0, parameter: 0 },
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
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-46652478-1",
              "p1-deck-46652479-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-46652477-0",
        "targetFieldIds": [
          8,
          9,
        ],
        "targetUids": [
          "p0-deck-46652478-1",
          "p1-deck-46652479-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [ownGrave!.uid, opponentGrave!.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === prophecy!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownGrave!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentGrave!.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ownDeck!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDeck!.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck")).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: ownGrave!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: prophecy!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: opponentGrave!.uid,
        eventPreviousState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 1, location: "deck", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: prophecy!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: ownGrave!.uid,
        eventPreviousState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: prophecy!.uid,
        eventReasonEffectId: 1,
        eventUids: [ownGrave!.uid, opponentGrave!.uid],
      },
    ]);
    expect(restored.host.messages).not.toContain("transmigration responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("transmigration responder resolved") end)
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
