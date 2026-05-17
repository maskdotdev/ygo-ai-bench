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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Burial from a Different Dimension banish return", () => {
  it("restores Burial from a Different Dimension's banished targets and return-to-Graveyard operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const burialCode = "48976825";
    const ownBanishedACode = "48976826";
    const ownBanishedBCode = "48976827";
    const opponentBanishedCode = "48976828";
    const responderCode = "48976829";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === burialCode),
      { code: ownBanishedACode, name: "Burial Own Banished A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ownBanishedBCode, name: "Burial Own Banished B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentBanishedCode, name: "Burial Opponent Banished", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Burial Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 489, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [burialCode, ownBanishedACode, ownBanishedBCode] }, 1: { main: [opponentBanishedCode, responderCode] } });
    startDuel(session);

    const burial = session.state.cards.find((card) => card.code === burialCode);
    const ownBanishedA = session.state.cards.find((card) => card.code === ownBanishedACode);
    const ownBanishedB = session.state.cards.find((card) => card.code === ownBanishedBCode);
    const opponentBanished = session.state.cards.find((card) => card.code === opponentBanishedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(burial).toBeDefined();
    expect(ownBanishedA).toBeDefined();
    expect(ownBanishedB).toBeDefined();
    expect(opponentBanished).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, burial!.uid, "hand", 0);
    moveDuelCard(session.state, ownBanishedA!.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, ownBanishedB!.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, opponentBanished!.uid, "banished", 1).faceUp = true;
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
    expect(host.loadCardScript(Number(burialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const burialAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === burial!.uid);
    expect(burialAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, burialAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 32,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-48976826-1",
              "p0-deck-48976827-2",
              "p1-deck-48976828-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-48976825-0",
        "targetUids": [
          "p0-deck-48976826-1",
          "p0-deck-48976827-2",
          "p1-deck-48976828-0",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x20, targetUids: [ownBanishedA!.uid, ownBanishedB!.uid, opponentBanished!.uid], count: 3, player: 0, parameter: 0 },
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
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 32,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-48976826-1",
              "p0-deck-48976827-2",
              "p1-deck-48976828-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-48976825-0",
        "targetUids": [
          "p0-deck-48976826-1",
          "p0-deck-48976827-2",
          "p1-deck-48976828-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x20, targetUids: [ownBanishedA!.uid, ownBanishedB!.uid, opponentBanished!.uid], count: 3, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === burial!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownBanishedA!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownBanishedB!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentBanished!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard")).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: ownBanishedA!.uid,
        eventPreviousState: { controller: 0, location: "banished", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.return,
        eventReasonPlayer: 0,
        eventReasonCardUid: burial!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: ownBanishedB!.uid,
        eventPreviousState: { controller: 0, location: "banished", sequence: 1, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 1, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.return,
        eventReasonPlayer: 0,
        eventReasonCardUid: burial!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentBanished!.uid,
        eventPreviousState: { controller: 1, location: "banished", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.return,
        eventReasonPlayer: 0,
        eventReasonCardUid: burial!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: ownBanishedA!.uid,
        eventPreviousState: { controller: 0, location: "banished", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.return,
        eventReasonPlayer: 0,
        eventReasonCardUid: burial!.uid,
        eventReasonEffectId: 1,
        eventUids: [ownBanishedA!.uid, ownBanishedB!.uid, opponentBanished!.uid],
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: burial!.uid,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 2, position: "faceDown", faceUp: true },
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
      },
    ]);
    expect(restored.host.messages).not.toContain("burial responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("burial responder resolved") end)
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
