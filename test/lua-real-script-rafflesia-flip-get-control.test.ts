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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rafflesia Seduction flip GetControl", () => {
  it("restores Rafflesia Seduction's flip target, temporary GetControl, and End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rafflesiaCode = "31440542";
    const targetCode = "31440543";
    const responderCode = "31440544";
    const script = workspace.readScript(`c${rafflesiaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rafflesiaCode),
      { code: targetCode, name: "Rafflesia Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1200 },
      { code: responderCode, name: "Rafflesia Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31440542, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rafflesiaCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const rafflesia = requireCard(session, rafflesiaCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, rafflesia.uid, "monsterZone", 0);
    rafflesia.position = "faceDownDefense";
    rafflesia.faceUp = false;
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rafflesiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const flip = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "flipSummon" && action.uid === rafflesia.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, flip!);
    expect(restoredOpenWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1",
        sourceUid: rafflesia.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1001,
        eventCardUid: rafflesia.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === rafflesia.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: rafflesia.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1001,
        eventCardUid: rafflesia.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x2000, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
        targetFieldIds: [5],
        targetUids: [target.uid],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChainWindow);
    expect(restoredChainWindow.session.state.chain).toHaveLength(0);
    expect(restoredChainWindow.host.messages).not.toContain("rafflesia responder resolved");
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === rafflesia.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: rafflesia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restoredChainWindow.session.state.effects.find((effect) => effect.registryKey === `lua:${targetCode}:temporary-control-return:${target.uid}`)).toMatchObject({
      code: 0x1200,
      controller: 1,
      event: "continuous",
      luaValueDescriptor: "temporary-control-return",
      ownerPlayer: 1,
      registryKey: `lua:${targetCode}:temporary-control-return:${target.uid}`,
      sourceUid: target.uid,
      value: 1,
    });

    const restoredReturnWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChainWindow.session), source, reader);
    expectCleanRestore(restoredReturnWindow);
    expectRestoredLegalActions(restoredReturnWindow, 0);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).toContain(`lua:${targetCode}:temporary-control-return:${target.uid}`);
    const endTurn = getLuaRestoreLegalActions(restoredReturnWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredReturnWindow, 0), null, 2)).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredReturnWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
    });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).not.toContain(`lua:${targetCode}:temporary-control-return:${target.uid}`);
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
      e:SetOperation(function(e,tp) Debug.Message("rafflesia responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
