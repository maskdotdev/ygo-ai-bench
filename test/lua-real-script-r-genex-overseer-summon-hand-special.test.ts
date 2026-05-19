import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setGenex = 0x2;

describe.skipIf(!hasUpstreamScripts)("Lua real script R-Genex Overseer summon hand Special Summon", () => {
  it("restores cloned summon triggers into a selected low-level Genex hand Special Summon", () => {
    assertOverseerHandSummon("normal");
    assertOverseerHandSummon("special");
  });
});

function assertOverseerHandSummon(kind: "normal" | "special"): void {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const overseerCode = "32744558";
  const targetCode = kind === "normal" ? "32744559" : "32744560";
  const highLevelCode = kind === "normal" ? "32744561" : "32744562";
  const offSetCode = kind === "normal" ? "32744563" : "32744564";
  const responderCode = kind === "normal" ? "32744565" : "32744566";
  const script = workspace.readScript(`c${overseerCode}.lua`);
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("local e2=e1:Clone()");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_GENEX) and c:GetLevel()<=3 and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

  const cards: DuelCardData[] = [
    { code: overseerCode, name: "R-Genex Overseer", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGenex], level: 2, attack: 1500, defense: 1200 },
    { code: targetCode, name: `R-Genex Overseer ${kind} Low-Level Genex Target`, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGenex], level: 3, attack: 1200, defense: 800 },
    { code: highLevelCode, name: `R-Genex Overseer ${kind} High-Level Genex Decoy`, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGenex], level: 4, attack: 1600, defense: 1000 },
    { code: offSetCode, name: `R-Genex Overseer ${kind} Off-Set Decoy`, kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 1000 },
    { code: responderCode, name: `R-Genex Overseer ${kind} Chain Responder`, kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: kind === "normal" ? 32744558 : 32744560, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [overseerCode, targetCode, highLevelCode, offSetCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  const overseer = requireCard(session, overseerCode);
  const target = requireCard(session, targetCode);
  const highLevel = requireCard(session, highLevelCode);
  const offSet = requireCard(session, offSetCode);
  const responder = requireCard(session, responderCode);
  moveDuelCard(session.state, overseer.uid, "hand", 0);
  moveDuelCard(session.state, target.uid, "hand", 0);
  moveDuelCard(session.state, highLevel.uid, "hand", 0);
  moveDuelCard(session.state, offSet.uid, "hand", 0);
  moveDuelCard(session.state, responder.uid, "hand", 1);
  session.state.turn = kind === "normal" ? 2 : 4;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript(kind);
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(overseerCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  let triggerWindowSnapshot = serializeDuel(session);
  const previousOverseerState = cardEventState(overseer);
  const currentOverseerState = { ...previousOverseerState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };
  if (kind === "normal") {
    const restoredSummonWindow = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === overseer.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);
    triggerWindowSnapshot = serializeDuel(restoredSummonWindow.session);
  } else {
    specialSummonDuelCard(session.state, overseer.uid, 0);
    triggerWindowSnapshot = serializeDuel(session);
  }

  const restoredTriggerWindow = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
  expectCleanRestore(restoredTriggerWindow);
  expectRestoredLegalActions(restoredTriggerWindow, 0);
  expect(restoredTriggerWindow.session.state.pendingTriggers).toHaveLength(1);
  const pendingTrigger = restoredTriggerWindow.session.state.pendingTriggers[0]!;
  expect(pendingTrigger).toEqual({
    id: "trigger-3-1",
    effectId: pendingTrigger.effectId,
    sourceUid: overseer.uid,
    player: 0,
    triggerBucket: "turnOptional",
    eventName: kind === "normal" ? "normalSummoned" : "specialSummoned",
    eventCode: kind === "normal" ? 1100 : 1102,
    eventCardUid: overseer.uid,
    eventReason: kind === "normal" ? duelReason.summon : duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventTriggerTiming: "when",
    eventPreviousState: previousOverseerState,
    eventCurrentState: currentOverseerState,
  });
  const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === overseer.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
  expect(restoredTriggerWindow.session.state.chain).toEqual([
    {
      id: "chain-3",
      chainIndex: 1,
      effectId: pendingTrigger.effectId,
      sourceUid: overseer.uid,
      player: 0,
      activationLocation: "monsterZone",
      activationSequence: 0,
      eventName: kind === "normal" ? "normalSummoned" : "specialSummoned",
      eventCode: kind === "normal" ? 1100 : 1102,
      eventCardUid: overseer.uid,
      eventReason: kind === "normal" ? duelReason.summon : duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      eventPreviousState: previousOverseerState,
      eventCurrentState: currentOverseerState,
      operationInfos: [{ category: 0x200, count: 1, parameter: 0x2, player: 0, targetUids: [] }],
    },
  ]);

  const targetPreviousState = cardEventState(target);
  const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
  expectCleanRestore(restoredChain);
  expectRestoredLegalActions(restoredChain, 1);
  expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  passChain(restoredChain);

  const triggerEffectId = kind === "normal" ? 1 : 2;
  expect(restoredChain.session.state.cards.find((card) => card.uid === overseer.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
    location: "monsterZone",
    controller: 0,
    sequence: 1,
    faceUp: true,
    position: "faceUpAttack",
    summonType: "special",
    reason: duelReason.summon | duelReason.specialSummon,
    reasonCardUid: overseer.uid,
    reasonEffectId: triggerEffectId,
  });
  expect(restoredChain.session.state.cards.find((card) => card.uid === highLevel.uid)).toMatchObject({ location: "hand", controller: 0 });
  expect(restoredChain.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "hand", controller: 0 });
  expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === target.uid)).toEqual([
    {
      eventName: "specialSummoned",
      eventCode: 1102,
      eventCardUid: target.uid,
      eventUids: [target.uid],
      eventReason: duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventReasonCardUid: overseer.uid,
      eventReasonEffectId: triggerEffectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
    },
  ]);
  expect(restoredChain.host.messages).not.toContain(`r-genex overseer ${kind} responder resolved`);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
}

function chainResponderScript(kind: "normal" | "special"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("r-genex overseer ${kind} responder resolved") end)
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    if (resolved.state.waitingFor !== undefined) {
      expect(resolved.legalActions).toEqual(getLuaRestoreLegalActions(restored, resolved.state.waitingFor));
      expect(resolved.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, resolved.state.waitingFor));
      expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    }
  }
}
