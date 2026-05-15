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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Twin Twisters discard cost", () => {
  it("restores Twin Twisters' discarded cost card, two targets, and grouped destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const twinTwistersCode = "43898403";
    const starterCode = "901";
    const responderCode = "902";
    const discardCode = "903";
    const firstTargetCode = "904";
    const secondTargetCode = "905";
    const drawnCode = "906";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === twinTwistersCode),
      { code: starterCode, name: "Twin Twisters Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Twin Twisters Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: discardCode, name: "Twin Twisters Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: firstTargetCode, name: "Twin Twisters First Backrow", kind: "trap", typeFlags: 0x4 },
      { code: secondTargetCode, name: "Twin Twisters Second Backrow", kind: "trap", typeFlags: 0x4 },
      { code: drawnCode, name: "Twin Twisters Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 469, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, firstTargetCode, secondTargetCode, drawnCode] }, 1: { main: [twinTwistersCode, discardCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const secondTarget = session.state.cards.find((card) => card.code === secondTargetCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const twinTwisters = session.state.cards.find((card) => card.code === twinTwistersCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(discard).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    expect(drawn).toBeDefined();
    expect(twinTwisters).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, firstTarget!.uid, "spellTrapZone", 0);
    firstTarget!.position = "faceDown";
    firstTarget!.faceUp = false;
    moveDuelCard(session.state, secondTarget!.uid, "spellTrapZone", 0);
    secondTarget!.position = "faceDown";
    secondTarget!.faceUp = false;
    moveDuelCard(session.state, discard!.uid, "hand", 1);
    moveDuelCard(session.state, twinTwisters!.uid, "spellTrapZone", 1);
    twinTwisters!.position = "faceDown";
    twinTwisters!.faceUp = false;
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
    expect(host.loadCardScript(Number(twinTwistersCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const twinTwistersAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === twinTwisters!.uid);
    expect(twinTwistersAction).toBeDefined();
    applyAndAssert(session, twinTwistersAction!);
    expect(session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    const discardEvent = {
      eventName: "discarded",
      eventCode: 1018,
      eventCardUid: discard!.uid,
      eventReason: duelReason.cost | duelReason.discard,
      eventReasonPlayer: 1,
      eventReasonCardUid: twinTwisters!.uid,
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
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-904-2",
              "p0-deck-905-3",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-43898403-0",
        "targetUids": [
          "p0-deck-904-2",
          "p0-deck-905-3",
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
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-904-2",
              "p0-deck-905-3",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-43898403-0",
        "targetUids": [
          "p0-deck-904-2",
          "p0-deck-905-3",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === secondTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === twinTwisters!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("twin twisters chain starter resolved");
    expect(restored.host.messages).not.toContain("twin twisters chain responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-904-2",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p1-deck-43898403-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 1,
        },
        {
          "eventCardUid": "p0-deck-905-3",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p1-deck-43898403-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 1,
        },
        {
          "eventCardUid": "p0-deck-904-2",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p1-deck-43898403-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 1,
          "eventUids": [
            "p0-deck-904-2",
            "p0-deck-905-3",
          ],
        },
        {
          "eventCardUid": "p0-deck-906-4",
          "eventCode": 1110,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventName": "cardsDrawn",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-901-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-906-4",
          ],
          "eventValue": 1,
        },
      ]
    `);
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
        Debug.Message("twin twisters chain starter resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("twin twisters chain responder resolved") end)
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
