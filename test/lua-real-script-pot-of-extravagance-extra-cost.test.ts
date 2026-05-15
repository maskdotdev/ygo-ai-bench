import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, drawDuelCards, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Extravagance extra deck cost", () => {
  it("restores Pot of Extravagance's random Extra Deck cost and draw lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "49238328";
    const extraCodes = ["940", "941", "942"];
    const drawCodes = ["943", "944"];
    const responderCode = "945";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      ...extraCodes.map((code, index) => ({ code, name: `Pot of Extravagance Extra ${index + 1}`, kind: "extra" as const, typeFlags: 0x40 })),
      ...drawCodes.map((code, index) => ({ code, name: `Pot of Extravagance Draw ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      { code: responderCode, name: "Pot of Extravagance Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 475, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, ...drawCodes], extra: extraCodes }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const liveDeckUids = getCards(session.state, 0, "deck").map((card) => card.uid);
    const drawUid = liveDeckUids[0];
    const blockedDrawUid = liveDeckUids[1];
    const originalExtraUids = getCards(session.state, 0, "extraDeck").map((card) => card.uid);
    expect(drawUid).toBeDefined();
    expect(blockedDrawUid).toBeDefined();
    expect(originalExtraUids).toHaveLength(3);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(potCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    session.state.phaseActivity = true;
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === pot!.uid)).toBe(false);
    session.state.phaseActivity = false;
    expect(session.state.randomCounter).toBe(0);

    const potAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pot!.uid);
    expect(potAction).toBeDefined();
    applyAndAssert(session, potAction!);
    expect(session.state.randomCounter).toBe(1);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "effectLabel": 100,
        "id": "chain-5",
        "operationInfos": [
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-49238328-0",
        "targetParam": 1,
        "targetPlayer": 0,
      }
    `);
    const banishedCostEvent = session.state.eventHistory.find(
      (event) => event.eventName === "banished" && event.eventUids?.length === 3 && event.eventUids.every((uid) => originalExtraUids.includes(uid)),
    );
    expect(banishedCostEvent).toBeDefined();
    const costUids = banishedCostEvent?.eventUids ?? [];
    expect(new Set(costUids).size).toBe(3);
    for (const uid of costUids) {
      expect(session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: false,
        position: "faceDownDefense",
        reason: 0x80,
      });
    }

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.randomCounter).toBe(1);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "effectLabel": 100,
        "id": "chain-5",
        "operationInfos": [
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-49238328-0",
        "targetParam": 1,
        "targetPlayer": 0,
      }
    `);
    for (const uid of costUids) {
      expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: false,
        position: "faceDownDefense",
        reason: 0x80,
      });
    }

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === drawUid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventCardUid: drawUid,
        eventValue: 1,
        eventUids: [drawUid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === pot!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === pot!.uid && effect.controller === 0 && effect.event === "continuous" && effect.code === 25)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 25,
        "controller": 0,
        "cost": [Function],
        "description": 787813250,
        "event": "continuous",
        "id": "lua-3-25",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 67110912,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:49238328:lua-3-25",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-49238328-0",
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
      }
    `);
    expect(drawDuelCards(restored.session.state, 0, 1, "Blocked effect draw")).toBe(0);
    expect(restored.session.state.cards.find((card) => card.uid === blockedDrawUid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.host.messages).not.toContain("pot of extravagance responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("pot of extravagance responder resolved") end)
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
