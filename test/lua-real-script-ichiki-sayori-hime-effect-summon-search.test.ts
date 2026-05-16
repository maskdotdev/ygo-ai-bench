import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ichiki Sayori-Hime effect summon search", () => {
  it("restores its hand ignition Normal Summon and summon-trigger 800-stat Deck search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ichikiCode = "9627299";
    const fieldConditionCode = "9627300";
    const searchTargetCode = "9627301";
    const invalidDeckCode = "9627302";
    const responderCode = "9627303";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ichikiCode),
      { code: fieldConditionCode, name: "Ichiki Face-up 800 Stat Condition", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 1000, attribute: attributeEarth },
      { code: searchTargetCode, name: "Ichiki Search Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 1200, attribute: attributeLight },
      { code: invalidDeckCode, name: "Ichiki Invalid Search Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeEarth },
      { code: responderCode, name: "Ichiki Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 962, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ichikiCode, fieldConditionCode, searchTargetCode, invalidDeckCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ichiki = session.state.cards.find((card) => card.code === ichikiCode);
    const fieldCondition = session.state.cards.find((card) => card.code === fieldConditionCode);
    const searchTarget = session.state.cards.find((card) => card.code === searchTargetCode);
    const invalidDeck = session.state.cards.find((card) => card.code === invalidDeckCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(ichiki).toBeDefined();
    expect(fieldCondition).toBeDefined();
    expect(searchTarget).toBeDefined();
    expect(invalidDeck).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, ichiki!.uid, "hand", 0);
    moveDuelCard(session.state, fieldCondition!.uid, "monsterZone", 0);
    fieldCondition!.position = "faceUpAttack";
    fieldCondition!.faceUp = true;
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
    expect(host.loadCardScript(Number(ichikiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const effect = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === ichiki!.uid);
    expect(effect, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, effect!);
    expect(restoredOpenWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "hand",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-7",
          "id": "chain-2",
          "operationInfos": [
            {
              "category": 256,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-9627299-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-9627299-0",
        },
      ]
    `);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredSummonChain.restoreComplete, restoredSummonChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonChain.missingRegistryKeys).toEqual([]);
    expect(restoredSummonChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonChain, 1);
    const summonPass = getLuaRestoreLegalActions(restoredSummonChain, 1).find((action) => action.type === "passChain");
    expect(summonPass, JSON.stringify(getLuaRestoreLegalActions(restoredSummonChain, 1), null, 2)).toBeDefined();
    const summonResolved = applyLuaRestoreResponse(restoredSummonChain, summonPass!);
    expect(summonResolved.ok, summonResolved.error).toBe(true);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === ichiki!.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "normal" });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-8-1100",
          "eventCardUid": "p0-deck-9627299-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-9627299-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === ichiki!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 1,
          "chainIndex": 1,
          "effectId": "lua-8-1100",
          "eventCardUid": "p0-deck-9627299-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "chain-6",
          "operationInfos": [
            {
              "category": 8,
              "count": 1,
              "parameter": 1,
              "player": 0,
              "targetUids": [],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-9627299-0",
        },
      ]
    `);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredSearchChain.restoreComplete, restoredSearchChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSearchChain.missingRegistryKeys).toEqual([]);
    expect(restoredSearchChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSearchChain, 1);
    const searchPass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
    expect(searchPass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
    const searchResolved = applyLuaRestoreResponse(restoredSearchChain, searchPass!);
    expect(searchResolved.ok, searchResolved.error).toBe(true);

    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === searchTarget!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === invalidDeck!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ichiki!.uid,
        eventReasonEffectId: 8,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ichiki!.uid,
        eventReasonEffectId: 8,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ichiki!.uid,
        eventReasonEffectId: 8,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${searchTargetCode}`]);
    expect(restoredSearchChain.host.messages).not.toContain("ichiki responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("ichiki responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
