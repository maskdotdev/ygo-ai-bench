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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Raigeki Break discard cost", () => {
  it("restores Raigeki Break's discarded cost card, target, and destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const raigekiBreakCode = "4178474";
    const starterCode = "897";
    const responderCode = "898";
    const discardCode = "899";
    const targetCode = "900";
    const drawnCode = "901";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === raigekiBreakCode),
      { code: starterCode, name: "Raigeki Break Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Raigeki Break Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: discardCode, name: "Raigeki Break Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: targetCode, name: "Raigeki Break Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: drawnCode, name: "Raigeki Break Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 468, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, targetCode, drawnCode] }, 1: { main: [raigekiBreakCode, discardCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const raigekiBreak = session.state.cards.find((card) => card.code === raigekiBreakCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(discard).toBeDefined();
    expect(target).toBeDefined();
    expect(drawn).toBeDefined();
    expect(raigekiBreak).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, discard!.uid, "hand", 1);
    moveDuelCard(session.state, raigekiBreak!.uid, "spellTrapZone", 1);
    raigekiBreak!.position = "faceDown";
    raigekiBreak!.faceUp = false;
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
    expect(host.loadCardScript(Number(raigekiBreakCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const raigekiBreakAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === raigekiBreak!.uid);
    expect(raigekiBreakAction).toBeDefined();
    applyAndAssert(session, raigekiBreakAction!);
    expect(session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    const discardEvent = {
      eventName: "discarded",
      eventCode: 1018,
      eventCardUid: discard!.uid,
      eventReason: duelReason.cost | duelReason.discard,
      eventReasonPlayer: 1,
      eventReasonCardUid: raigekiBreak!.uid,
      eventReasonEffectId: 3,
      eventPreviousState: { controller: 1, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 1, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
    };
    expect(session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-900-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-4178474-0",
        "targetFieldIds": [
          9,
        ],
        "targetUids": [
          "p0-deck-900-2",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1002",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-900-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-4178474-0",
        "targetFieldIds": [
          9,
        ],
        "targetUids": [
          "p0-deck-900-2",
        ],
      }
    `);
    expect(restored.session.state.chain[1]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === raigekiBreak!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("raigeki break chain starter resolved");
    expect(restored.host.messages).not.toContain("raigeki break chain responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: raigekiBreak!.uid,
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
        Debug.Message("raigeki break chain starter resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("raigeki break chain responder resolved") end)
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
