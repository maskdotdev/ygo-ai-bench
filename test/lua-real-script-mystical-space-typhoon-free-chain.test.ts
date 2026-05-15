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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mystical Space Typhoon free-chain target", () => {
  it("restores Mystical Space Typhoon's backrow target and destroys it", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mstCode = "5318639";
    const starterCode = "891";
    const responderCode = "892";
    const targetTrapCode = "893";
    const drawnCode = "894";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mstCode),
      { code: starterCode, name: "MST Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "MST Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: targetTrapCode, name: "MST Target Backrow", kind: "trap", typeFlags: 0x4 },
      { code: drawnCode, name: "MST Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 466, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, targetTrapCode, drawnCode] }, 1: { main: [mstCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const targetTrap = session.state.cards.find((card) => card.code === targetTrapCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const mst = session.state.cards.find((card) => card.code === mstCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(targetTrap).toBeDefined();
    expect(drawn).toBeDefined();
    expect(mst).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, targetTrap!.uid, "spellTrapZone", 0);
    targetTrap!.position = "faceDown";
    targetTrap!.faceUp = false;
    moveDuelCard(session.state, mst!.uid, "spellTrapZone", 1);
    mst!.position = "faceDown";
    mst!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mstCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const mstAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === mst!.uid);
    expect(mstAction).toBeDefined();
    applyAndAssert(session, mstAction!);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 1,
            "targetUids": [
              "p0-deck-893-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-5318639-0",
        "targetUids": [
          "p0-deck-893-2",
        ],
      }
    `);
    expect(session.state.chain[1]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [targetTrap!.uid], count: 1, player: 1, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 1,
            "targetUids": [
              "p0-deck-893-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-5318639-0",
        "targetUids": [
          "p0-deck-893-2",
        ],
      }
    `);
    expect(restored.session.state.chain[1]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [targetTrap!.uid], count: 1, player: 1, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === targetTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === mst!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("mst chain starter resolved");
    expect(restored.host.messages).not.toContain("mst chain responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetTrap!.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: mst!.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawn!.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventPreviousState: {
          location: "deck",
          controller: 0,
          sequence: 2,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "hand",
          controller: 0,
          sequence: 2,
          position: "faceDown",
          faceUp: false,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: starter!.uid,
        eventReasonEffectId: 1,
        eventUids: [drawn!.uid],
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([]);
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("mst chain starter resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("mst chain responder resolved") end)
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
