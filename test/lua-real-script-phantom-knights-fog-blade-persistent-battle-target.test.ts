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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Phantom Knights' Fog Blade persistent battle target lock", () => {
  it("restores official persistent disable, attack lock, and battle-target selection lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fogBladeCode = "25542642";
    const attackerCode = "613601";
    const targetCode = "613602";
    const decoyCode = "613603";
    const responderCode = "613604";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fogBladeCode),
      { code: attackerCode, name: "Fog Blade Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: targetCode, name: "Fog Blade Effect Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: decoyCode, name: "Fog Blade Open Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Fog Blade Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fogBladeCode, attackerCode] }, 1: { main: [targetCode, decoyCode, responderCode] } });
    startDuel(session);

    const fogBlade = session.state.cards.find((card) => card.code === fogBladeCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const decoy = session.state.cards.find((card) => card.code === decoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(fogBlade).toBeDefined();
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(decoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, fogBlade!.uid, "spellTrapZone", 0);
    fogBlade!.position = "faceDown";
    fogBlade!.faceUp = false;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, decoy!.uid, "monsterZone", 1);
    decoy!.position = "faceUpAttack";
    decoy!.faceUp = true;
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
    expect(host.loadCardScript(Number(fogBladeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === fogBlade!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: fogBlade!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x4000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === fogBlade!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("fog blade responder resolved");

    const persistentSnapshot = serializeDuel(restoredChain.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredPersistent.restoreComplete, restoredPersistent.incompleteReasons.join("; ")).toBe(true);
    const persistentProbe = restoredPersistent.host.loadScript(
      persistentFogBladeProbeScript(fogBladeCode, targetCode),
      "phantom-knights-fog-blade-persistent-probe.lua",
    );
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("fog blade persistent true/true/1/true/false");

    const battle = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, battle!);
    const battleActions = getLuaRestoreLegalActions(restoredPersistent, 0);
    expect(battleActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid, targetUid: decoy!.uid })]));
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid)).toBe(false);

    const restoredTargetSent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredTargetSent.restoreComplete, restoredTargetSent.incompleteReasons.join("; ")).toBe(true);
    sendDuelCardToGraveyard(restoredTargetSent.session.state, target!.uid, 1, duelReason.effect, 0);
    expect(restoredTargetSent.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetSent.session.state.cards.find((card) => card.uid === fogBlade!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });

    const restoredTargetDestroyed = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expect(restoredTargetDestroyed.restoreComplete, restoredTargetDestroyed.incompleteReasons.join("; ")).toBe(true);
    destroyDuelCard(restoredTargetDestroyed.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === fogBlade!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
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
      e:SetOperation(function(e,tp) Debug.Message("fog blade responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function persistentFogBladeProbeScript(fogBladeCode: string, targetCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fogBladeCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
    local persistent=Effect.CreateEffect(trap)
    Debug.Message(
      "fog blade persistent " ..
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
