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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Moon Dance Ritual persistent overlay", () => {
  it("restores official persistent target operation into End Phase overlay material movement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ritualCode = "14005031";
    const targetCode = "613401";
    const responderCode = "613402";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ritualCode),
      {
        code: targetCode,
        name: "Moon Dance Ritual WIND Xyz Target",
        kind: "extra",
        typeFlags: 0x800021,
        level: 4,
        attribute: 0x8,
        attack: 1800,
        defense: 1200,
      },
      { code: responderCode, name: "Moon Dance Ritual Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ritualCode], extra: [targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ritual = session.state.cards.find((card) => card.code === ritualCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(ritual).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, ritual!.uid, "spellTrapZone", 0);
    ritual!.position = "faceDown";
    ritual!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main2";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ritualCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === ritual!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: ritual!.uid,
      targetUids: [target!.uid],
    });
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("moon dance ritual responder resolved");

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPersistent.missingRegistryKeys).toEqual([]);
    const persistentProbe = restoredPersistent.host.loadScript(
      persistentOverlayProbeScript(ritualCode, targetCode),
      "moon-dance-ritual-persistent-overlay-probe.lua",
    );
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("moon dance persistent true/true/1/1/true/0");

    const endPhase = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, endPhase!);
    expect(restoredPersistent.session.state.phase).toBe("end");
    expect(restoredPersistent.session.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseEnd", eventCode: 0x1200 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ritual!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    const restoredOverlayChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredOverlayChain.restoreComplete, restoredOverlayChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOverlayChain.missingRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredOverlayChain);
    expect(restoredOverlayChain.session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      previousLocation: "spellTrapZone",
    });
    expect(restoredOverlayChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      overlayUids: [ritual!.uid],
    });
    expect(restoredOverlayChain.host.messages).not.toContain("moon dance ritual responder resolved");

    const restoredOverlay = restoreDuelWithLuaScripts(serializeDuel(restoredOverlayChain.session), source, reader);
    expect(restoredOverlay.restoreComplete, restoredOverlay.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOverlay.missingRegistryKeys).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("moon dance ritual responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function persistentOverlayProbeScript(ritualCode: string, targetCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ritualCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local persistent=Effect.CreateEffect(trap)
    Debug.Message(
      "moon dance persistent " ..
      tostring(trap:IsHasCardTarget(target)) .. "/" ..
      tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" ..
      trap:GetCardTargetCount() .. "/" ..
      trap:GetFlagEffect(${ritualCode}) .. "/" ..
      tostring(target:IsDisabled()) .. "/" ..
      target:GetOverlayCount()
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
