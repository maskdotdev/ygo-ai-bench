import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const brainJackerCode = "40267580";
const targetCode = "402675800";
const responderCode = "402675801";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const categoryRecover = 0x100000;
const effectEquipLimit = 76;
const effectSetControl = 4;
const eventPhaseStandby = 0x1002;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Brain Jacker flip equip recover", () => {
  it("restores flip-trigger equip control and opponent Standby CHAININFO recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${brainJackerCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === brainJackerCode),
      { code: targetCode, name: "Brain Jacker Fixture Steal Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Brain Jacker Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 40267580, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brainJackerCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const brainJacker = requireCard(session, brainJackerCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, brainJacker.uid, "monsterZone", 0);
    brainJacker.position = "faceDownDefense";
    brainJacker.faceUp = false;
    moveFaceUpAttack(session, target, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(brainJackerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const flip = getLegalActions(session, 0).find((action) => action.type === "flipSummon" && action.uid === brainJacker.uid);
    expect(flip, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, flip!);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1",
        sourceUid: brainJacker.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventCardUid: brainJacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === brainJacker.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1",
        eventCardUid: brainJacker.uid,
        eventCode: 1101,
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventName: "flipSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "chain-3",
        operationInfos: [
          { category: categoryControl, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
          { category: categoryEquip, targetUids: [brainJacker.uid], count: 1, player: 0, parameter: 0 },
        ],
        player: 0,
        sourceUid: brainJacker.uid,
        targetFieldIds: [target.fieldId],
        targetUids: [target.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("brain jacker responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === brainJacker.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === brainJacker.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: categoryEquip, code: undefined, countLimit: undefined, event: "trigger", property: 16, range: allLocations, reset: undefined, triggerEvent: "flipSummoned", value: undefined },
      { category: undefined, code: eventPhaseStandby, countLimit: 1, event: "trigger", property: undefined, range: ["spellTrapZone"], reset: undefined, triggerEvent: "phaseStandby", value: undefined },
      { category: undefined, code: effectEquipLimit, countLimit: undefined, event: "continuous", property: 1024, range: ["spellTrapZone"], reset: { flags: 33427456 }, triggerEvent: undefined, value: undefined },
      { category: undefined, code: effectSetControl, countLimit: undefined, event: "continuous", property: undefined, range: ["spellTrapZone"], reset: { flags: 33296384 }, triggerEvent: undefined, value: 0 },
    ]);

    restoredChain.session.state.turn = 2;
    restoredChain.session.state.turnPlayer = 1;
    restoredChain.session.state.phase = "draw";
    restoredChain.session.state.waitingFor = 1;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    const standby = getLuaRestoreLegalActions(restoredDraw, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers.map(({ id: _id, ...pending }) => pending)).toEqual([
      {
        player: 0,
        effectId: "lua-2-4098",
        sourceUid: brainJacker.uid,
        eventName: "phaseStandby",
        eventCode: eventPhaseStandby,
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredRecoverTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredRecoverTrigger);
    expectRestoredLegalActions(restoredRecoverTrigger, 0);
    const recoverTrigger = getLuaRestoreLegalActions(restoredRecoverTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === brainJacker.uid);
    expect(recoverTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRecoverTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredRecoverTrigger, recoverTrigger!);
    expect(restoredRecoverTrigger.session.state.chain.map((link) => ({
      effectId: link.effectId,
      operationInfos: link.operationInfos,
      player: link.player,
      sourceUid: link.sourceUid,
      targetParam: link.targetParam,
      targetPlayer: link.targetPlayer,
    }))).toEqual([
      {
        effectId: "lua-2-4098",
        operationInfos: [{ category: categoryRecover, targetUids: [], count: 0, player: 1, parameter: 500 }],
        player: 0,
        sourceUid: brainJacker.uid,
        targetParam: 500,
        targetPlayer: 1,
      },
    ]);

    const restoredRecover = restoreDuelWithLuaScripts(serializeDuel(restoredRecoverTrigger.session), source, reader);
    expectCleanRestore(restoredRecover);
    expectRestoredLegalActions(restoredRecover, 1);
    passRestoredChain(restoredRecover);
    expect(restoredRecover.session.state.players[1].lifePoints).toBe(8500);
    expect(restoredRecover.session.state.cards.find((card) => card.uid === brainJacker.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
    });
    expect(restoredRecover.session.state.eventHistory.filter((event) => ["controlChanged", "phaseStandby", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: brainJacker.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      { eventName: "phaseStandby", eventCode: eventPhaseStandby },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: brainJacker.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Brain Jacker");
  expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.CheckStealEquip,tp,0,LOCATION_MZONE,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,0,0)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_CONTROL)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetParam(500)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.position = "faceUpAttack";
  card.faceUp = true;
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
      e:SetOperation(function(e,tp) Debug.Message("brain jacker responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
