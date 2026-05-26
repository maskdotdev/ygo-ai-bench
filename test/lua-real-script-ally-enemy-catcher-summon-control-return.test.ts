import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const enemyCatcherCode = "45033006";
const hasEnemyCatcherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${enemyCatcherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasEnemyCatcherScript)("Lua real script Ally of Justice Enemy Catcher summon control return", () => {
  it("restores summon-triggered face-down Defense control and the End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "450330060";
    const responderCode = "450330061";
    const script = workspace.readScript(`c${enemyCatcherCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return c:IsFacedown() and c:IsDefensePos() and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const cards: DuelCardData[] = [
      { code: enemyCatcherCode, name: "Ally of Justice Enemy Catcher", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1800 },
      { code: targetCode, name: "Enemy Catcher Face-Down Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1400 },
      { code: responderCode, name: "Enemy Catcher Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45033, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [enemyCatcherCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const enemyCatcher = requireCard(session, enemyCatcherCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, enemyCatcher.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.position = "faceDownDefense";
    target.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(enemyCatcherCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === enemyCatcher.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === enemyCatcher.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChainWindow, 1);

    const restoredResolvedWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChainWindow.session), source, reader);
    expect(restoredResolvedWindow.restoreComplete, restoredResolvedWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResolvedWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResolvedWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredResolvedWindow, 0);
    expect(getLuaRestoreLegalActions(restoredResolvedWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);

    expect(restoredResolvedWindow.host.messages).not.toContain("enemy catcher responder resolved");
    expect(restoredResolvedWindow.session.state.cards.find((card) => card.uid === enemyCatcher.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredResolvedWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      position: "faceDownDefense",
      faceUp: false,
    });
    expect(restoredResolvedWindow.session.state.effects.find((effect) => effect.registryKey === `lua:${targetCode}:temporary-control-return:${target.uid}`)).toMatchObject({
      code: 0x1200,
      event: "continuous",
      luaValueDescriptor: "temporary-control-return",
      registryKey: `lua:${targetCode}:temporary-control-return:${target.uid}`,
      sourceUid: target.uid,
      value: 1,
    });
    expect(restoredResolvedWindow.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: enemyCatcher.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceDownDefense", faceUp: false },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 1, position: "faceDownDefense", faceUp: false },
      },
    ]);

    const restoredReturnWindow = restoreDuelWithLuaScripts(serializeDuel(restoredResolvedWindow.session), source, reader);
    expect(restoredReturnWindow.restoreComplete, restoredReturnWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReturnWindow.missingRegistryKeys).toEqual([]);
    expect(restoredReturnWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredReturnWindow, 0);
    const endTurn = getLuaRestoreLegalActions(restoredReturnWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredReturnWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(nextTurn.legalActions).toEqual(getLuaRestoreLegalActions(restoredReturnWindow, nextTurn.state.waitingFor!));
    expect(nextTurn.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restoredReturnWindow, nextTurn.state.waitingFor!));
    expect(nextTurn.legalActionGroups.flatMap((group) => group.actions)).toEqual(nextTurn.legalActions);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      position: "faceDownDefense",
      faceUp: false,
    });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).not.toContain(`lua:${targetCode}:temporary-control-return:${target.uid}`);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("enemy catcher responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
