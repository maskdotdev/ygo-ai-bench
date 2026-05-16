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
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Supervise Gemini equip revive", () => {
  it("restores Equip-granted Gemini status and its sent-to-Graveyard Special Summon trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const superviseCode = "95750695";
    const geminiCode = "3918345";
    const normalCode = "95750696";
    const responderCode = "95750697";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === superviseCode || card.code === geminiCode),
      { code: normalCode, name: "Supervise Graveyard Normal", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Supervise Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 957, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [superviseCode, geminiCode, normalCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const supervise = session.state.cards.find((card) => card.code === superviseCode);
    const gemini = session.state.cards.find((card) => card.code === geminiCode);
    const normal = session.state.cards.find((card) => card.code === normalCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(supervise).toBeDefined();
    expect(gemini).toBeDefined();
    expect(normal).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, supervise!.uid, "hand", 0);
    moveDuelCard(session.state, gemini!.uid, "monsterZone", 0);
    gemini!.faceUp = true;
    gemini!.position = "faceUpAttack";
    moveDuelCard(session.state, normal!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(superviseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    assertGeminiStatus(restoredEquipWindow, geminiCode, false);
    const equip = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === supervise!.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipWindow, equip!);
    expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-95750695-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-95750695-0",
        "targetUids": [
          "p0-deck-3918345-1",
        ],
      }
    `);

    const restoredEquipChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredEquipChain.restoreComplete, restoredEquipChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipChain.missingRegistryKeys).toEqual([]);
    expect(restoredEquipChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredEquipChain, 1)).toEqual(getGroupedDuelLegalActions(restoredEquipChain.session, 1));
    expect(getLuaRestoreLegalActions(restoredEquipChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredEquipChain);
    expect(restoredEquipChain.host.messages).not.toContain("supervise responder resolved");
    expect(restoredEquipChain.session.state.cards.find((card) => card.uid === supervise!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: gemini!.uid,
      faceUp: true,
    });

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredEquipChain.session), source, reader);
    expect(restoredEquipped.restoreComplete, restoredEquipped.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipped.missingRegistryKeys).toEqual([]);
    expect(restoredEquipped.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(
      restoredEquipped.session.state.effects.filter(
        (effect) => effect.sourceUid === supervise!.uid && effect.event === "continuous" && (effect.code === 75 || effect.code === 76),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:95750695:lua-2-76",
          "sourceUid": "p0-deck-95750695-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 75,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-75",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:95750695:lua-3-75",
          "sourceUid": "p0-deck-95750695-0",
          "target": [Function],
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-6-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:95750695:lua-6-76",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-95750695-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);
    assertGeminiStatus(restoredEquipped, geminiCode, true);

    const sent = restoredEquipped.host.loadScript(
      `
        local supervise=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${superviseCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
        Debug.Message("supervise sent " .. Duel.SendtoGrave(supervise,REASON_EFFECT))
      `,
      "supervise-send-to-grave.lua",
    );
    expect(sent.ok, sent.error).toBe(true);
    expect(restoredEquipped.host.messages).toContain("supervise sent 1");
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === supervise!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: gemini!.uid,
    });
    assertGeminiStatus(restoredEquipped, geminiCode, false);
    expect(restoredEquipped.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-4-1014",
          "eventCardUid": "p0-deck-95750695-0",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-95750695-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-95750695-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === supervise!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "graveyard",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-4-1014",
        "eventCardUid": "p0-deck-95750695-0",
        "eventCode": 1014,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "graveyard",
          "position": "faceUpAttack",
          "sequence": 1,
        },
        "eventName": "sentToGraveyard",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": true,
          "location": "spellTrapZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventReason": 64,
        "eventReasonCardUid": "p0-deck-95750695-0",
        "eventReasonEffectId": 1,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-6",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-95750696-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-95750695-0",
        "targetUids": [
          "p0-deck-95750696-2",
        ],
      }
    `);

    const restoredReviveChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredReviveChain.restoreComplete, restoredReviveChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReviveChain.missingRegistryKeys).toEqual([]);
    expect(restoredReviveChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredReviveChain, 1);
    expect(getLuaRestoreLegalActions(restoredReviveChain, 1)).toEqual(getDuelLegalActions(restoredReviveChain.session, 1));
    resolveRestoredChain(restoredReviveChain);
    expect(restoredReviveChain.session.state.cards.find((card) => card.uid === normal!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredReviveChain.session.state.cards.find((card) => card.uid === supervise!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredReviveChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normal!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: supervise!.uid,
        eventReasonEffectId: 4,
        eventUids: [normal!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredReviveChain.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === supervise!.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: supervise!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: supervise!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredReviveChain.host.messages).not.toContain("supervise responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("supervise responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("supervise gemini status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `supervise-gemini-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`supervise gemini status ${expected ? "true" : "false"}`);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
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
