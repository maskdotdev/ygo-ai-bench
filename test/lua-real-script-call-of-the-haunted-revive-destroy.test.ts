import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Call of the Haunted revive destroy", () => {
  it("restores Call of the Haunted's Continuous Trap revive and mutual destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const callCode = "97077563";
    const targetCode = "612701";
    const responderCode = "612702";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === callCode),
      { code: targetCode, name: "Call of the Haunted Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: responderCode, name: "Call of the Haunted Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [callCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const call = session.state.cards.find((card) => card.code === callCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(call).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, call!.uid, "spellTrapZone", 0);
    call!.position = "faceDown";
    call!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(callCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === call!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-612701-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-97077563-0",
        "targetUids": [
          "p0-deck-612701-1",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-612701-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-97077563-0",
        "targetUids": [
          "p0-deck-612701-1",
        ],
      }
    `);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("call responder resolved");

    const resolvedSnapshot = serializeDuel(restoredChain.session);
    const restoredRevive = restoreDuelWithLuaScripts(resolvedSnapshot, source, reader);
    expect(restoredRevive.restoreComplete, restoredRevive.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredRevive, 0);
    expect(restoredRevive.missingRegistryKeys).toEqual([]);
    expect(restoredRevive.missingChainLimitRegistryKeys).toEqual([]);
    expectLuaCallProbe(restoredRevive, targetCode, callCode, "call probe 0/612701/1");

    destroyDuelCard(restoredRevive.session.state, call!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-612701-1",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-97077563-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const restoredTrapDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), source, reader);
    expect(restoredTrapDestroyed.restoreComplete, restoredTrapDestroyed.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredTrapDestroyed, 0);
    expect(restoredTrapDestroyed.missingRegistryKeys).toEqual([]);
    expect(restoredTrapDestroyed.missingChainLimitRegistryKeys).toEqual([]);

    const restoredTargetDestroy = restoreDuelWithLuaScripts(resolvedSnapshot, source, reader);
    expect(restoredTargetDestroy.restoreComplete, restoredTargetDestroy.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredTargetDestroy, 0);
    expect(restoredTargetDestroy.missingRegistryKeys).toEqual([]);
    expect(restoredTargetDestroy.missingChainLimitRegistryKeys).toEqual([]);
    destroyDuelCard(restoredTargetDestroy.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredTargetDestroy.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === call!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-97077563-0",
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
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-97077563-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const restoredMonsterDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredTargetDestroy.session), source, reader);
    expect(restoredMonsterDestroyed.restoreComplete, restoredMonsterDestroyed.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredMonsterDestroyed, 0);
    expect(restoredMonsterDestroyed.missingRegistryKeys).toEqual([]);
    expect(restoredMonsterDestroyed.missingChainLimitRegistryKeys).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("call responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaCallProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, callCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local trap=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${callCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local first=trap and trap:GetFirstCardTarget()
      Debug.Message("call probe " .. target:GetControler() .. "/" .. tostring(first and first:GetCode()) .. "/" .. trap:GetCardTargetCount())
    `,
    "call-of-the-haunted-revive-destroy-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
