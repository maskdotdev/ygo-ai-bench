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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Upstart Goblin draw and recover", () => {
  it("restores Upstart Goblin's draw/recover operation info and resolves both effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const upstartCode = "70368879";
    const drawnCode = "911";
    const responderCode = "912";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === upstartCode),
      { code: drawnCode, name: "Upstart Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Upstart Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 471, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [upstartCode, drawnCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const upstart = session.state.cards.find((card) => card.code === upstartCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(upstart).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, upstart!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(upstartCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const upstartAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === upstart!.uid);
    expect(upstartAction).toBeDefined();
    applyAndAssert(session, upstartAction!);
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
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1000,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-70368879-0",
        "targetParam": 1,
        "targetPlayer": 0,
      }
    `);

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
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 1048576,
            "count": 0,
            "parameter": 1000,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-70368879-0",
        "targetParam": 1,
        "targetPlayer": 0,
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.players[1].lifePoints).toBe(9000);
    expect(restored.session.state.eventHistory.filter((event) => ["cardsDrawn", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawn!.uid],
        eventCardUid: drawn!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: upstart!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: upstart!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === upstart!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).not.toContain("upstart goblin responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("upstart goblin responder resolved") end)
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
