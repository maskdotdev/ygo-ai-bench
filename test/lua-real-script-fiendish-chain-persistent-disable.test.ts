import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fiendish Chain persistent disable", () => {
  it("restores official persistent disable and destroy-only target cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fiendishCode = "50078509";
    const targetCode = "613201";
    const responderCode = "613202";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fiendishCode),
      { code: targetCode, name: "Fiendish Chain Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Fiendish Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fiendishCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const fiendish = session.state.cards.find((card) => card.code === fiendishCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(fiendish).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, fiendish!.uid, "spellTrapZone", 0);
    fiendish!.position = "faceDown";
    fiendish!.faceUp = false;
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
    expect(host.loadCardScript(Number(fiendishCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === fiendish!.uid);
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
            "category": 16384,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-613201-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-50078509-0",
        "targetUids": [
          "p1-deck-613201-0",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === fiendish!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("fiendish chain responder resolved");

    const persistentSnapshot = serializeDuel(restoredChain.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPersistent.missingRegistryKeys).toEqual([]);
    expect(restoredPersistent.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPersistent, 0);
    const persistentProbe = restoredPersistent.host.loadScript(
      persistentDisableProbeScript(fiendishCode, targetCode),
      "fiendish-chain-persistent-disable-probe.lua",
    );
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("fiendish persistent true/true/1/true/false");

    const battle = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, battle!);
    expect(getLuaRestoreLegalActions(restoredPersistent, 1).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid)).toBe(false);

    const restoredNonDestroyLeave = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredNonDestroyLeave.restoreComplete, restoredNonDestroyLeave.incompleteReasons.join("; ")).toBe(true);
    expect(restoredNonDestroyLeave.missingRegistryKeys).toEqual([]);
    expect(restoredNonDestroyLeave.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredNonDestroyLeave, 0);
    sendDuelCardToGraveyard(restoredNonDestroyLeave.session.state, target!.uid, 1, duelReason.effect, 0);
    expect(restoredNonDestroyLeave.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredNonDestroyLeave.session.state.cards.find((card) => card.uid === fiendish!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredNonDestroyLeave.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === fiendish!.uid)).toMatchInlineSnapshot(`[]`);

    const restoredTargetDestroyed = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredTargetDestroyed.restoreComplete, restoredTargetDestroyed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTargetDestroyed.missingRegistryKeys).toEqual([]);
    expect(restoredTargetDestroyed.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTargetDestroyed, 0);
    destroyDuelCard(restoredTargetDestroyed.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === fiendish!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredTargetDestroyed.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === fiendish!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-50078509-0",
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
            "faceUp": true,
            "location": "spellTrapZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-50078509-0",
          "eventReasonEffectId": 5,
          "eventReasonPlayer": 0,
        },
      ]
    `);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredTargetDestroyed.session), source, reader);
    expect(restoredDestroyed.restoreComplete, restoredDestroyed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDestroyed.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyed.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDestroyed, 0);
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
      e:SetOperation(function(e,tp) Debug.Message("fiendish chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function persistentDisableProbeScript(fiendishCode: string, targetCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fiendishCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
    local persistent=Effect.CreateEffect(trap)
    Debug.Message(
      "fiendish persistent " ..
      tostring(trap:IsHasCardTarget(target)) .. "/" ..
      tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" ..
      trap:GetCardTargetCount() .. "/" ..
      tostring(target:IsDisabled()) .. "/" ..
      tostring(target:CanAttack())
    )
  `;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
