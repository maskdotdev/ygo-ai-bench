import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nightmare Wheel persistent damage", () => {
  it("restores official persistent trap target relation into Standby Phase damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wheelCode = "54704216";
    const targetCode = "613001";
    const responderCode = "613002";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wheelCode),
      { code: targetCode, name: "Nightmare Wheel Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Nightmare Wheel Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wheelCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const wheel = session.state.cards.find((card) => card.code === wheelCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(wheel).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, wheel!.uid, "spellTrapZone", 0);
    wheel!.position = "faceDown";
    wheel!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wheelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === wheel!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: wheel!.uid,
      targetUids: [target!.uid],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === wheel!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("nightmare wheel responder resolved");

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPersistent.missingRegistryKeys).toEqual([]);
    expect(restoredPersistent.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPersistent, 0);
    expectLuaPersistentProbe(restoredPersistent, wheelCode, targetCode);

    const standby = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, standby!);
    expect(restoredPersistent.session.state.phase).toBe("standby");
    expect(restoredPersistent.session.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseStandby", eventCode: 0x1002 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === wheel!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: wheel!.uid,
      targetPlayer: 1,
      targetParam: 500,
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
    });
    expect(getLuaRestoreLegalActions(restoredTrigger, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredDamageChain.restoreComplete, restoredDamageChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageChain.missingRegistryKeys).toEqual([]);
    expect(restoredDamageChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageChain, 1);
    resolveRestoredChain(restoredDamageChain);
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredDamageChain.host.messages).not.toContain("nightmare wheel responder resolved");

    destroyDuelCard(restoredDamageChain.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0);
    expect(restoredDamageChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDamageChain.session.state.cards.find((card) => card.uid === wheel!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredDamageChain.session), source, reader);
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
      e:SetOperation(function(e,tp) Debug.Message("nightmare wheel responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLuaPersistentProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, wheelCode: string, targetCode: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wheelCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message("nightmare wheel persistent " .. tostring(trap:IsHasCardTarget(target)) .. "/" .. tostring(aux.PersistentTargetFilter(e,target)) .. "/" .. trap:GetCardTargetCount())
    `,
    "nightmare-wheel-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain("nightmare wheel persistent true/true/1");
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
