import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const massHypnosisCode = "21768554";
const alienCode = "217685540";
const targetCode = "217685541";
const responderCode = "217685542";
const setAlien = 0xc;
const counterA = 0x100e;
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mass Hypnosis counter control end destroy", () => {
  it("restores A-counter targeting into persistent control and End Phase self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${massHypnosisCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_ALIEN),tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return c:GetCounter(COUNTER_A)>0 and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,ft,nil)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e1:SetCondition(s.con)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === massHypnosisCode),
      { code: alienCode, name: "Mass Hypnosis Alien Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], level: 4, attack: 1600, defense: 1000 },
      { code: targetCode, name: "Mass Hypnosis A-Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Mass Hypnosis Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21768554, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [massHypnosisCode, alienCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const massHypnosis = requireCard(session, massHypnosisCode);
    const alien = requireCard(session, alienCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, alien, 0);
    moveFaceUpAttack(session, target, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    const setTrap = moveDuelCard(session.state, massHypnosis.uid, "spellTrapZone", 0);
    setTrap.faceUp = false;
    setTrap.position = "faceDown";
    expect(addDuelCardCounter(target, counterA, 1)).toBe(true);
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
    expect(host.loadCardScript(Number(massHypnosisCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(
      restoredOpen.session.state.effects.map((effect) => ({
        category: effect.category,
        code: effect.code,
        event: effect.event,
        property: effect.property,
        range: effect.range,
        sourceUid: effect.sourceUid,
        triggerEvent: effect.triggerEvent,
      })),
    ).toEqual([
      { category: categoryControl, code: 1002, event: "quick", property: 16, range: ["spellTrapZone"], sourceUid: massHypnosis.uid, triggerEvent: undefined },
      { category: undefined, code: eventPhaseEnd, event: "trigger", property: undefined, range: ["spellTrapZone"], sourceUid: massHypnosis.uid, triggerEvent: "phaseEnd" },
      { category: undefined, code: 1002, event: "quick", property: undefined, range: ["hand"], sourceUid: responder.uid, triggerEvent: undefined },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === massHypnosis.uid && action.effectId === "lua-1-1002");
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: massHypnosis.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [target.uid],
        operationInfos: [{ category: categoryControl, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("mass hypnosis responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === massHypnosis.uid)).toMatchObject({ controller: 0, location: "spellTrapZone", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ controller: 0, previousController: 1, location: "monsterZone" });
    expect(restoredChain.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 4 && effect.sourceUid === target.uid)).toMatchObject({
      code: 4,
      controller: 1,
      event: "continuous",
      sourceUid: target.uid,
      value: 0,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === massHypnosis.uid)?.cardTargetUids).toEqual([target.uid]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: massHypnosis.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 1, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const restoredControlled = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredControlled);
    expectRestoredLegalActions(restoredControlled, 0);
    changePhase(restoredControlled, 0, "battle");
    changePhase(restoredControlled, 0, "main2");
    changePhase(restoredControlled, 0, "end");
    expect(restoredControlled.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-8-1",
        player: 0,
        effectId: "lua-2-4608",
        sourceUid: massHypnosis.uid,
        triggerBucket: "turnMandatory",
        eventName: "phaseEnd",
        eventCode: eventPhaseEnd,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredControlled.session), source, reader);
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    const endTrigger = getLuaRestoreLegalActions(restoredEndTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === massHypnosis.uid && action.effectId === "lua-2-4608");
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEndTrigger, endTrigger!);
    expect(restoredEndTrigger.session.state.chain).toEqual([
      {
        id: "chain-8",
        chainIndex: 1,
        effectId: "lua-2-4608",
        sourceUid: massHypnosis.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "phaseEnd",
        eventCode: eventPhaseEnd,
        eventTriggerTiming: "when",
        operationInfos: [{ category: 0x1, targetUids: [massHypnosis.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredEndChain = restoreDuelWithLuaScripts(serializeDuel(restoredEndTrigger.session), source, reader);
    expectCleanRestore(restoredEndChain);
    expectRestoredLegalActions(restoredEndChain, 1);
    resolveRestoredChain(restoredEndChain);
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === massHypnosis.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: massHypnosis.uid,
      reasonEffectId: 2,
    });
    expect(restoredEndChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === massHypnosis.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: massHypnosis.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: massHypnosis.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
      },
    ]);
  });
});

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
      e:SetOperation(function(e,tp) Debug.Message("mass hypnosis responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, action!);
}
