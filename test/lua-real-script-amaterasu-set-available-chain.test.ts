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
const typeMonster = 0x1;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amaterasu set-available chain", () => {
  it("restores its face-down Quick Effect response to an opponent's targeting chain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const amaterasuCode = "20073910";
    const noblemanCode = "71044499";
    const drawCode = "20073911";
    const responderCode = "20073912";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [amaterasuCode, noblemanCode].includes(card.code)),
      { code: drawCode, name: "Amaterasu Draw Card", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Amaterasu Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2007, startingHandSize: 0, drawPerTurn: 1, cardReader: reader });
    loadDecks(session, { 0: { main: [amaterasuCode, drawCode] }, 1: { main: [noblemanCode, responderCode] } });
    startDuel(session);

    const amaterasu = session.state.cards.find((card) => card.code === amaterasuCode);
    const nobleman = session.state.cards.find((card) => card.code === noblemanCode);
    const drawCard = session.state.cards.find((card) => card.code === drawCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(amaterasu).toBeDefined();
    expect(nobleman).toBeDefined();
    expect(drawCard).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, amaterasu!.uid, "monsterZone", 0);
    amaterasu!.position = "faceDownDefense";
    amaterasu!.faceUp = false;
    moveDuelCard(session.state, nobleman!.uid, "hand", 1);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(amaterasuCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(noblemanCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const noblemanAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === nobleman!.uid);
    expect(noblemanAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, noblemanAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-9-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-20073910-0",
            ],
          },
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-20073910-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-71044499-0",
        "targetFieldIds": [
          5,
        ],
        "targetUids": [
          "p0-deck-20073910-0",
        ],
      }
    `);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpenChain, 0);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 0)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 0));
    const amaterasuAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === amaterasu!.uid);
    expect(amaterasuAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, amaterasuAction!);

    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === amaterasu!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredOpenChain.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-7-1027",
        "eventCardUid": "p1-deck-71044499-0",
        "eventChainDepth": 1,
        "eventChainLinkId": "chain-2",
        "eventCode": 1027,
        "eventCurrentState": {
          "controller": 1,
          "faceUp": true,
          "location": "spellTrapZone",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventName": "chaining",
        "eventPlayer": 1,
        "eventPreviousState": {
          "controller": 1,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventReasonPlayer": 1,
        "eventValue": 1,
        "id": "chain-4",
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
        "sourceUid": "p0-deck-20073910-0",
        "targetParam": 1,
        "targetPlayer": 0,
      }
    `);

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredPendingResolution, 1);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    passUntilResolved(restoredPendingResolution);

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === amaterasu!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === nobleman!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === responder!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: amaterasu!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: amaterasu!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawCard!.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawCard!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: amaterasu!.uid,
        eventReasonEffectId: 7,
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
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === amaterasu!.uid)).toEqual([]);
    expect(restoredPendingResolution.host.messages).not.toContain("amaterasu chain responder resolved");
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("amaterasu chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passUntilResolved(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(8);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
