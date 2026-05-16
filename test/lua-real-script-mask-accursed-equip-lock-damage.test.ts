import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mask of the Accursed equip lock damage", () => {
  it("restores equip target attack lock and Standby damage to the equipped monster controller", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maskCode = "56948373";
    const targetCode = "56940001";
    const responderCode = "56940002";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maskCode),
      { code: targetCode, name: "Mask of the Accursed Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Mask of the Accursed Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 569, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maskCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const mask = session.state.cards.find((card) => card.code === maskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(mask).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, mask!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
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
    expect(host.loadCardScript(Number(maskCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === mask!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toHaveLength(1);
    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
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
              "p0-deck-56948373-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-56948373-0",
        "targetUids": [
          "p1-deck-56940001-0",
        ],
      }
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === mask!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("mask responder resolved");

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPersistent.missingRegistryKeys).toEqual([]);
    expect(restoredPersistent.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPersistent, 0);
    expectLuaEquipProbe(restoredPersistent, maskCode, targetCode);

    restoredPersistent.session.state.phase = "battle";
    restoredPersistent.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredPersistent, 1).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid)).toBe(false);

    restoredPersistent.session.state.phase = "draw";
    restoredPersistent.session.state.waitingFor = 0;
    const standby = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, standby!);
    expect(restoredPersistent.session.state.pendingTriggers[0]).toMatchInlineSnapshot(`
      {
        "effectId": "lua-4-4098",
        "eventCode": 4098,
        "eventName": "phaseStandby",
        "eventTriggerTiming": "when",
        "id": "trigger-6-1",
        "player": 0,
        "sourceUid": "p0-deck-56948373-0",
        "triggerBucket": "turnMandatory",
      }
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === mask!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-4-4098",
        "eventCode": 4098,
        "eventName": "phaseStandby",
        "eventTriggerTiming": "when",
        "id": "chain-6",
        "operationInfos": [
          {
            "category": 524288,
            "count": 0,
            "parameter": 500,
            "player": 1,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-56948373-0",
        "targetParam": 500,
        "targetPlayer": 1,
      }
    `);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredDamageChain.restoreComplete, restoredDamageChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageChain.missingRegistryKeys).toEqual([]);
    expect(restoredDamageChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageChain, 1);
    resolveRestoredChain(restoredDamageChain);
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredDamageChain.host.messages).not.toContain("mask responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("mask responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, maskCode: string, targetCode: string): void {
  const probe = restored.host.loadScript(
    `
      local mask=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${maskCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
      Debug.Message("mask equip " .. tostring(mask:GetEquipTarget()==target) .. "/" .. tostring(mask:IsHasCardTarget(target)) .. "/" .. mask:GetCardTargetCount())
    `,
    "mask-accursed-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain("mask equip true/true/1");
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}
