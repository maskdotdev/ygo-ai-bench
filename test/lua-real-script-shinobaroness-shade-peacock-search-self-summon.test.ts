import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, ritualSummonDuelCard, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shinobaroness Shade Peacock search and self summon", () => {
  it("restores its Ritual-summoned search trigger and banished next-Standby self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shadeCode = "33325951";
    const callingCode = "73055622";
    const materialCode = "33325950";
    const invalidSpellCode = "33325952";
    const responderCode = "33325953";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shadeCode || card.code === callingCode),
      { code: materialCode, name: "Shinobaroness Ritual Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: invalidSpellCode, name: "Shinobaroness Invalid Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Shinobaroness Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3332, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shadeCode, materialCode, callingCode, invalidSpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const shade = session.state.cards.find((card) => card.code === shadeCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const calling = session.state.cards.find((card) => card.code === callingCode);
    const invalidSpell = session.state.cards.find((card) => card.code === invalidSpellCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(shade).toBeDefined();
    expect(material).toBeDefined();
    expect(calling).toBeDefined();
    expect(invalidSpell).toBeDefined();
    expect(responder).toBeDefined();
    shade!.data.ritualMaterials = [materialCode];
    moveDuelCard(session.state, shade!.uid, "hand", 0);
    moveDuelCard(session.state, material!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(shadeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(callingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    ritualSummonDuelCard(session.state, 0, shade!.uid, [material!.uid]);
    expect(session.state.cards.find((card) => card.uid === shade!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "ritual",
    });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1102",
          "eventCardUid": "p0-deck-33325951-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-33325951-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const searchTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === shade!.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, searchTrigger!);
    expect(restoredTriggerWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-7-1102",
          "eventCardUid": "p0-deck-33325951-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
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
          "sourceUid": "p0-deck-33325951-0",
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
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === calling!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === invalidSpell!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-73055622-2",
          "eventCode": 1012,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToHand",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-33325951-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-73055622-2",
          "eventCode": 1211,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "confirmed",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-33325951-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-73055622-2",
          ],
          "eventValue": 1,
        },
        {
          "eventCardUid": "p0-deck-73055622-2",
          "eventCode": 1212,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToHandConfirmed",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-33325951-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-73055622-2",
          ],
          "eventValue": 1,
        },
      ]
    `);
    expect(restoredSearchChain.host.messages).not.toContain("shinobaroness responder resolved");

    moveDuelCard(restoredSearchChain.session.state, shade!.uid, "banished", 0);
    const banishedShade = restoredSearchChain.session.state.cards.find((card) => card.uid === shade!.uid)!;
    banishedShade.faceUp = true;
    banishedShade.turnId = restoredSearchChain.session.state.turn;
    restoredSearchChain.session.state.turn = banishedShade.turnId + 1;
    restoredSearchChain.session.state.turnPlayer = 0;
    restoredSearchChain.session.state.phase = "draw";
    restoredSearchChain.session.state.waitingFor = 0;

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredSearchChain.session), source, reader);
    expect(restoredDraw.restoreComplete, restoredDraw.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDraw.missingRegistryKeys).toEqual([]);
    expect(restoredDraw.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-8-4098",
          "eventCode": 4098,
          "eventName": "phaseStandby",
          "eventTriggerTiming": "when",
          "id": "trigger-9-1",
          "player": 0,
          "sourceUid": "p0-deck-33325951-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredSelfSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expect(restoredSelfSummonTrigger.restoreComplete, restoredSelfSummonTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSelfSummonTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredSelfSummonTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSelfSummonTrigger, 0);
    const selfSummonTrigger = getLuaRestoreLegalActions(restoredSelfSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === shade!.uid);
    expect(selfSummonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSelfSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSelfSummonTrigger, selfSummonTrigger!);
    expect(restoredSelfSummonTrigger.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "banished",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-8-4098",
          "eventCode": 4098,
          "eventName": "phaseStandby",
          "eventTriggerTiming": "when",
          "id": "chain-9",
          "operationInfos": [
            {
              "category": 512,
              "count": 1,
              "parameter": 32,
              "player": 0,
              "targetUids": [
                "p0-deck-33325951-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-33325951-0",
        },
      ]
    `);

    const restoredSelfSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredSelfSummonTrigger.session), source, reader);
    expect(restoredSelfSummonChain.restoreComplete, restoredSelfSummonChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSelfSummonChain.missingRegistryKeys).toEqual([]);
    expect(restoredSelfSummonChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSelfSummonChain, 1);
    const selfSummonPass = getLuaRestoreLegalActions(restoredSelfSummonChain, 1).find((action) => action.type === "passChain");
    expect(selfSummonPass, JSON.stringify(getLuaRestoreLegalActions(restoredSelfSummonChain, 1), null, 2)).toBeDefined();
    const selfSummonResolved = applyLuaRestoreResponse(restoredSelfSummonChain, selfSummonPass!);
    expect(selfSummonResolved.ok, selfSummonResolved.error).toBe(true);
    expect(restoredSelfSummonChain.session.state.cards.find((card) => card.uid === shade!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restoredSelfSummonChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === shade!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-33325951-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-33325951-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "banished",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonCardUid": "p0-deck-33325951-0",
          "eventReasonEffectId": 8,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-33325951-0",
          ],
        },
      ]
    `);
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
      e:SetOperation(function(e,tp) Debug.Message("shinobaroness responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
