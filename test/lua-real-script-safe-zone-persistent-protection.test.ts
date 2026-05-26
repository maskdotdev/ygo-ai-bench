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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Safe Zone persistent protection", () => {
  it("restores official persistent protection, targetability, direct-attack lock, and handler-leaves cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const safeZoneCode = "38296564";
    const targetCode = "613101";
    const responderCode = "613102";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === safeZoneCode),
      { code: targetCode, name: "Safe Zone Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Safe Zone Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [safeZoneCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const safeZone = session.state.cards.find((card) => card.code === safeZoneCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(safeZone).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, safeZone!.uid, "spellTrapZone", 0);
    safeZone!.position = "faceDown";
    safeZone!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
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
    expect(host.loadCardScript(Number(safeZoneCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === safeZone!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-38296564-0",
        "targetFieldIds": [
          5,
        ],
        "targetUids": [
          "p0-deck-613101-1",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === safeZone!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("safe zone responder resolved");

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredProtection);
    expectRestoredLegalActions(restoredProtection, 0);
    const protectionProbe = restoredProtection.host.loadScript(
      protectionProbeScript(safeZoneCode, targetCode, responderCode),
      "safe-zone-persistent-protection-probe.lua",
    );
    expect(protectionProbe.ok, protectionProbe.error).toBe(true);
    expect(restoredProtection.host.messages).toContain("safe zone protection true/true/1/1/0/false/true/false/true");

    const battle = getLuaRestoreLegalActions(restoredProtection, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredProtection, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredProtection, battle!);
    expect(getLuaRestoreLegalActions(restoredProtection, 0).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid)).toBe(false);

    const protectedSnapshot = serializeDuel(restoredChain.session);

    const restoredTargetLeaves = restoreDuelWithLuaScripts(protectedSnapshot, source, reader);
    expectCleanRestore(restoredTargetLeaves);
    expectRestoredLegalActions(restoredTargetLeaves, 0);
    sendDuelCardToGraveyard(restoredTargetLeaves.session.state, target!.uid, 0, duelReason.effect, 0);
    expect(restoredTargetLeaves.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetLeaves.session.state.cards.find((card) => card.uid === safeZone!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredTargetLeaves.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === safeZone!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-38296564-0",
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
          "eventReasonCardUid": "p0-deck-38296564-0",
          "eventReasonEffectId": 9,
          "eventReasonPlayer": 0,
        },
      ]
    `);

    const restoredHandlerLeaves = restoreDuelWithLuaScripts(protectedSnapshot, source, reader);
    expectCleanRestore(restoredHandlerLeaves);
    expectRestoredLegalActions(restoredHandlerLeaves, 0);
    destroyDuelCard(restoredHandlerLeaves.session.state, safeZone!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredHandlerLeaves.session.state.cards.find((card) => card.uid === safeZone!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredHandlerLeaves.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredHandlerLeaves.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-613101-1",
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
          "eventReasonCardUid": "p0-deck-38296564-0",
          "eventReasonEffectId": 8,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredHandlerLeaves.session), source, reader);
    expectCleanRestore(restoredDestroyed);
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
      e:SetOperation(function(e,tp) Debug.Message("safe zone responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function protectionProbeScript(safeZoneCode: string, targetCode: string, responderCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${safeZoneCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local opponent_source=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${responderCode}),1,LOCATION_HAND,0,nil)
    local persistent=Effect.CreateEffect(trap)
    local own_effect=Effect.CreateEffect(trap)
    local opponent_effect=Effect.CreateEffect(opponent_source)
    Debug.Message(
      "safe zone protection " ..
      tostring(trap:IsHasCardTarget(target)) .. "/" ..
      tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" ..
      trap:GetCardTargetCount() .. "/" ..
      trap:GetFlagEffect(${safeZoneCode}) .. "/" ..
      tostring(trap:GetFlagEffectLabel(${safeZoneCode})) .. "/" ..
      tostring(target:IsDestructable(opponent_effect)) .. "/" ..
      tostring(target:IsDestructable(own_effect)) .. "/" ..
      tostring(target:IsCanBeEffectTarget(opponent_effect)) .. "/" ..
      tostring(target:IsCanBeEffectTarget(own_effect))
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
