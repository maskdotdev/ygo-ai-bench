import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Book of Moon free chain", () => {
  it("restores Book of Moon's selected target and turns it face-down on resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bookOfMoonCode = "14087893";
    const responderCode = "860";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bookOfMoonCode),
      { code: responderCode, name: "Book of Moon Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Book of Moon Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 459, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bookOfMoonCode] }, 1: { main: [responderCode, "200"] } });
    startDuel(session);

    const bookOfMoon = session.state.cards.find((card) => card.code === bookOfMoonCode);
    const target = session.state.cards.find((card) => card.code === "200");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(bookOfMoon).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, bookOfMoon!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    target!.turnId = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bookOfMoonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const bookAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === bookOfMoon!.uid);
    expect(bookAction).toBeDefined();
    applyAndAssert(session, bookAction!);
    expect(queryPublicState(session)).toMatchObject({ phase: "main1", waitingFor: 1, windowKind: "chainResponse" });
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
            "category": 4096,
            "count": 1,
            "parameter": 8,
            "player": 0,
            "targetUids": [
              "p1-deck-200-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-14087893-0",
        "targetUids": [
          "p1-deck-200-1",
        ],
      }
    `);
    expect(session.state.cards.find((card) => card.uid === bookOfMoon!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });

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
            "category": 4096,
            "count": 1,
            "parameter": 8,
            "player": 0,
            "targetUids": [
              "p1-deck-200-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-14087893-0",
        "targetUids": [
          "p1-deck-200-1",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1000, targetUids: [target!.uid], count: 1, player: 0, parameter: 8 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restored.session.state.cards.find((card) => card.uid === bookOfMoon!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bookOfMoon!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("book of moon responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("book of moon responder resolved") end)
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
