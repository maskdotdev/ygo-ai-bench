import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const golemCode = "52323207";
const targetCode = "523232070";
const responderCode = "523232071";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Golem Sentry turn set and flip to hand", () => {
  it("restores ignition turn-set flag and flip-summon mandatory target return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${golemCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("c:IsCanTurnSet() and c:GetFlagEffect(id)==0");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");

    const cards = createCards(workspace);
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };

    const setSession = createDuel({ seed: 52323207, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(setSession, { 0: { main: [golemCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(setSession);
    const setGolem = requireCard(setSession, golemCode);
    moveDuelCard(setSession.state, setGolem.uid, "monsterZone", 0);
    setGolem.position = "faceUpAttack";
    setGolem.faceUp = true;
    setSession.state.phase = "main1";
    setSession.state.turnPlayer = 0;
    setSession.state.waitingFor = 0;
    const setHost = createLuaScriptHost(setSession, workspace);
    expect(setHost.loadCardScript(Number(golemCode), source).ok).toBe(true);
    expect(setHost.registerInitialEffects()).toBe(1);

    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(setSession), source, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    const turnSet = getLuaRestoreLegalActions(restoredSet, 0).find((action) => action.type === "activateEffect" && action.uid === setGolem.uid);
    expect(turnSet, JSON.stringify(getLuaRestoreLegalActions(restoredSet, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSet, turnSet!);
    expect(restoredSet.session.state.chain).toEqual([]);
    expect(restoredSet.session.state.cards.find((card) => card.uid === setGolem.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restoredSet.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: setGolem.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: setGolem.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);
    const restoredSetAfterResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSet.session), source, reader);
    expectCleanRestore(restoredSetAfterResolution);
    expectRestoredLegalActions(restoredSetAfterResolution, 0);

    const flipSession = createDuel({ seed: 52323208, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(flipSession, { 0: { main: [golemCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(flipSession);
    const flipGolem = requireCard(flipSession, golemCode);
    const target = requireCard(flipSession, targetCode);
    const responder = requireCard(flipSession, responderCode);
    const movedGolem = moveDuelCard(flipSession.state, flipGolem.uid, "monsterZone", 0);
    movedGolem.position = "faceDownDefense";
    movedGolem.faceUp = false;
    const movedTarget = moveDuelCard(flipSession.state, target.uid, "monsterZone", 1);
    movedTarget.position = "faceUpAttack";
    movedTarget.faceUp = true;
    moveDuelCard(flipSession.state, responder.uid, "hand", 1);
    flipSession.state.phase = "main1";
    flipSession.state.turnPlayer = 0;
    flipSession.state.waitingFor = 0;

    const flipHost = createLuaScriptHost(flipSession, workspace);
    expect(flipHost.loadCardScript(Number(golemCode), source).ok).toBe(true);
    expect(flipHost.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(flipHost.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(flipSession), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === flipGolem.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1101",
        sourceUid: flipGolem.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventPlayer: 0,
        eventCardUid: flipGolem.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === flipGolem.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: flipGolem.uid,
        player: 0,
        effectId: "lua-2-1101",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1101,
        eventPlayer: 0,
        eventCardUid: flipGolem.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        targetFieldIds: [target.fieldId],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x8, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, pass!);
    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === flipGolem.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "hand", controller: 1, reason: duelReason.effect });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("golem sentry responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => ["flipSummoned", "sentToHand"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: flipGolem.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: flipGolem.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "hand", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function createCards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === golemCode),
    { code: targetCode, name: "Golem Sentry Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1200 },
    { code: responderCode, name: "Golem Sentry Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
      e:SetOperation(function(e,tp) Debug.Message("golem sentry responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
