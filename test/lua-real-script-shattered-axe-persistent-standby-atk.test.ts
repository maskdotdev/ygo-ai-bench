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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shattered Axe persistent Standby ATK", () => {
  it("restores official persistent target relation into Standby flag-based ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shatteredAxeCode = "12117532";
    const targetCode = "613801";
    const responderCode = "613802";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shatteredAxeCode),
      { code: targetCode, name: "Shattered Axe Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Shattered Axe Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 320, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shatteredAxeCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const shatteredAxe = session.state.cards.find((card) => card.code === shatteredAxeCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(shatteredAxe).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, shatteredAxe!.uid, "spellTrapZone", 0);
    shatteredAxe!.position = "faceDown";
    shatteredAxe!.faceUp = false;
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
    expect(host.loadCardScript(Number(shatteredAxeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === shatteredAxe!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(activation)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([
      { category: 0x4000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
    ]);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === shatteredAxe!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredActivation.host.messages).not.toContain("shattered axe responder resolved");
    for (let index = 0; index < 4 && restoredActivation.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredActivation.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredActivation, passPlayer!).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, passPlayer!), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restoredActivation, pass!);
    }
    expect(restoredActivation.session.state.chain).toEqual([]);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === shatteredAxe!.uid)).toMatchObject({
      cardTargetUids: [target!.uid],
    });

    const persistentSnapshot = serializeDuel(restoredActivation.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expectShatteredAxeProbe(restoredPersistent, shatteredAxeCode, targetCode, "shattered axe persistent true/true/1/0/1800");

    const standby = getLuaRestoreLegalActions(restoredPersistent, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredPersistent, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPersistent, standby!);
    expect(restoredPersistent.session.state.phase).toBe("standby");
    expect(restoredPersistent.session.state.eventHistory.filter((event) => event.eventName === "phaseStandby")).toEqual([
      {
        eventName: "phaseStandby",
        eventCode: 0x1002,
      },
    ]);

    const restoredAfterStandby = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), source, reader);
    expectCleanRestore(restoredAfterStandby);
    expectRestoredLegalActions(restoredAfterStandby, 0);
    expectShatteredAxeProbe(restoredAfterStandby, shatteredAxeCode, targetCode, "shattered axe persistent true/true/1/1/1300");

    destroyDuelCard(restoredAfterStandby.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0);
    expect(restoredAfterStandby.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredAfterStandby.session.state.cards.find((card) => card.uid === shatteredAxe!.uid)).toMatchObject({
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
      e:SetOperation(function(e,tp) Debug.Message("shattered axe responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectShatteredAxeProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, shatteredAxeCode: string, targetCode: string, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${shatteredAxeCode}),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "shattered axe persistent " ..
        tostring(trap:IsHasCardTarget(target)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,target)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        target:GetFlagEffect(${shatteredAxeCode}) .. "/" ..
        target:GetAttack()
      )
    `,
    "shattered-axe-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
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
