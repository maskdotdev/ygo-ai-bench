import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hastorrCode = "70913714";
const targetCode = "709137140";
const responderCode = "709137141";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryEquip = 0x40000;
const categoryLeaveGrave = 0x4000000;
const categoryControl = 0x2000;
const eventToGrave = 1014;
const eventLeaveField = 1015;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Old Entity Hastorr grave equip control", () => {
  it("restores field-to-Grave equip trigger into disable lock and leave-field control steal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hastorrCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hastorrCode),
      { code: targetCode, name: "Old Entity Hastorr Fixture Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1200 },
      { code: responderCode, name: "Old Entity Hastorr Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 70913714, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [hastorrCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const hastorr = requireCard(session, hastorrCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, hastorr, 0);
    moveFaceUpAttack(session, target, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hastorrCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    sendDuelCardToGraveyard(restoredOpen.session.state, hastorr.uid, 0, duelReason.effect, 0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === hastorr.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1014",
        eventCardUid: hastorr.uid,
        eventCode: eventToGrave,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: hastorr.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hastorr.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1014",
        sourceUid: hastorr.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "sentToGraveyard",
        eventCode: eventToGrave,
        eventPlayer: 0,
        eventCardUid: hastorr.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        targetUids: [target.uid],
        targetFieldIds: [target.fieldId],
        operationInfos: [
          { category: categoryEquip, targetUids: [hastorr.uid], count: 1, player: 0, parameter: 0 },
          { category: categoryLeaveGrave, targetUids: [hastorr.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("hastorr responder resolved");
    const equippedTarget = restoredChain.session.state.cards.find((card) => card.uid === target.uid)!;
    expect(restoredChain.session.state.cards.find((card) => card.uid === hastorr.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(equippedTarget).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(isCardDisabled(restoredChain.session.state, equippedTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === hastorr.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
      valueType: typeof effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", reset: undefined, triggerEvent: undefined, valueType: "undefined" },
      { code: eventToGrave, event: "trigger", reset: undefined, triggerEvent: "sentToGraveyard", valueType: "undefined" },
      { code: 76, event: "continuous", reset: { flags: 33427456 }, triggerEvent: undefined, valueType: "undefined" },
      { code: 2, event: "continuous", reset: { flags: 33427456 }, triggerEvent: undefined, valueType: "undefined" },
      { code: 85, event: "continuous", reset: { flags: 33427456 }, triggerEvent: undefined, valueType: "undefined" },
      { code: eventLeaveField, event: "trigger", reset: { flags: 16912384 }, triggerEvent: "leftField", valueType: "undefined" },
    ]);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    sendDuelCardToGraveyard(restoredEquipped.session.state, hastorr.uid, 0, duelReason.effect, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === hastorr.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
    });
    expect(restoredEquipped.session.state.pendingTriggers).toHaveLength(1);
    expect(restoredEquipped.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventCurrentState: trigger.eventCurrentState,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventPreviousState: trigger.eventPreviousState,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([{
        effectId: "lua-8-1015",
        eventCardUid: hastorr.uid,
        eventCode: eventLeaveField,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "leftField",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hastorr.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: hastorr.uid,
        triggerBucket: "turnMandatory",
    }]);

    const restoredLeave = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 0);
    const leaveTrigger = getLuaRestoreLegalActions(restoredLeave, 0).find((action) => action.type === "activateTrigger" && action.uid === hastorr.uid);
    expect(leaveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, leaveTrigger!);
    expect(restoredLeave.session.state.chain.map((link) => ({
      effectId: link.effectId,
      eventName: link.eventName,
      eventCode: link.eventCode,
      operationInfos: link.operationInfos,
      targetUids: link.targetUids,
    }))).toEqual([{
      effectId: "lua-8-1015",
      eventName: "leftField",
      eventCode: eventLeaveField,
      operationInfos: [{ category: categoryControl, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      targetUids: [target.uid],
    }]);
    resolveRestoredChain(restoredLeave);
    expect(restoredLeave.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: hastorr.uid,
      reasonEffectId: 8,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Old Entity Hastorr");
  expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.Equip(tp,c,tc,true)");
  expect(script).toContain("e4:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("local ec=e:GetHandler():GetPreviousEquipTarget()");
  expect(script).toContain("Duel.GetControl(ec,tp)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("hastorr responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
