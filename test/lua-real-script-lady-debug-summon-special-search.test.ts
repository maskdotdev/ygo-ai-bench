import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceCyberse = 0x1000000;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lady Debug summon and special summon search", () => {
  it("restores delayed cloned summon triggers that search only Level 3 or lower Cyberse monsters", () => {
    assertLadyDebugSearch("normal");
    assertLadyDebugSearch("special");
  });
});

function assertLadyDebugSearch(kind: "normal" | "special"): void {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const ladyDebugCode = "16188701";
  const cyberseTargetCode = kind === "normal" ? "16188702" : "16188705";
  const highLevelCyberseCode = kind === "normal" ? "16188703" : "16188706";
  const offRaceLowLevelCode = kind === "normal" ? "16188704" : "16188707";
  const responderCode = kind === "normal" ? "16188708" : "16188709";
  const script = workspace.readScript(`c${ladyDebugCode}.lua`);
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("local e2=e1:Clone()");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsLevelBelow(3) and c:IsRace(RACE_CYBERSE) and c:IsAbleToHand()");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ladyDebugCode),
    { code: cyberseTargetCode, name: `Lady Debug ${kind} Cyberse Target`, kind: "monster", typeFlags: typeMonster, level: 3, race: raceCyberse, attack: 1000, defense: 1000 },
    { code: highLevelCyberseCode, name: `Lady Debug ${kind} High-Level Cyberse Decoy`, kind: "monster", typeFlags: typeMonster, level: 4, race: raceCyberse, attack: 1500, defense: 1500 },
    { code: offRaceLowLevelCode, name: `Lady Debug ${kind} Dragon Decoy`, kind: "monster", typeFlags: typeMonster, level: 3, race: raceDragon, attack: 1200, defense: 1200 },
    { code: responderCode, name: `Lady Debug ${kind} Chain Responder`, kind: "monster", typeFlags: typeMonster, level: 4 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: kind === "normal" ? 16188701 : 16188705, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ladyDebugCode, cyberseTargetCode, highLevelCyberseCode, offRaceLowLevelCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  const ladyDebug = requireCard(session.state.cards, ladyDebugCode);
  const target = requireCard(session.state.cards, cyberseTargetCode);
  const highLevelDecoy = requireCard(session.state.cards, highLevelCyberseCode);
  const offRaceDecoy = requireCard(session.state.cards, offRaceLowLevelCode);
  const responder = requireCard(session.state.cards, responderCode);
  moveDuelCard(session.state, ladyDebug.uid, "hand", 0);
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
  expect(host.loadCardScript(Number(ladyDebugCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  let triggerWindowSnapshot = serializeDuel(session);
  const previousLadyDebugState = cardEventState(ladyDebug);
  const currentLadyDebugState = { ...previousLadyDebugState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };
  if (kind === "normal") {
    const restoredOpen = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === ladyDebug.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    triggerWindowSnapshot = serializeDuel(restoredOpen.session);
  } else {
    specialSummonDuelCard(session.state, ladyDebug.uid, 0);
    triggerWindowSnapshot = serializeDuel(session);
  }

  const expectedEvent = eventShape(kind);
  const restoredTriggerWindow = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
  expectCleanRestore(restoredTriggerWindow);
  expectRestoredLegalActions(restoredTriggerWindow, 0);
  expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
    {
      id: "trigger-3-1",
      effectId: `lua-${expectedEvent.effectId}-${expectedEvent.code}`,
      sourceUid: ladyDebug.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: ladyDebug.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventTriggerTiming: "if",
      eventPreviousState: previousLadyDebugState,
      eventCurrentState: currentLadyDebugState,
    },
  ]);
  const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === ladyDebug.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
  expect(restoredTriggerWindow.session.state.chain).toEqual([
    {
      id: "chain-3",
      chainIndex: 1,
      effectId: `lua-${expectedEvent.effectId}-${expectedEvent.code}`,
      sourceUid: ladyDebug.uid,
      player: 0,
      activationLocation: "monsterZone",
      activationSequence: 0,
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: ladyDebug.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventTriggerTiming: "if",
      eventPreviousState: previousLadyDebugState,
      eventCurrentState: currentLadyDebugState,
      operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
    },
  ]);

  const targetPreviousState = cardEventState(target);
  const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
  expectCleanRestore(restoredSearchChain);
  expectRestoredLegalActions(restoredSearchChain, 1);
  expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  const pass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredSearchChain, pass!);

  expect(restoredSearchChain.session.state.chain).toEqual([]);
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === ladyDebug.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "hand", controller: 0 });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === highLevelDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === offRaceDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
  expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${cyberseTargetCode}`]);
  expect(restoredSearchChain.host.messages).not.toContain(`lady debug ${kind} responder resolved`);
  expect(
    restoredSearchChain.session.state.eventHistory.filter((event) =>
      [expectedEvent.name, "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
    ),
  ).toEqual([
    {
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: ladyDebug.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventPreviousState: previousLadyDebugState,
      eventCurrentState: currentLadyDebugState,
    },
    {
      eventName: "sentToHand",
      eventCode: 1012,
      eventCardUid: target.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: ladyDebug.uid,
      eventReasonEffectId: expectedEvent.effectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "confirmed",
      eventCode: 1211,
      eventPlayer: 1,
      eventUids: [target.uid],
      eventValue: 1,
      eventCardUid: target.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: ladyDebug.uid,
      eventReasonEffectId: expectedEvent.effectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "sentToHandConfirmed",
      eventCode: 1212,
      eventPlayer: 1,
      eventUids: [target.uid],
      eventValue: 1,
      eventCardUid: target.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: ladyDebug.uid,
      eventReasonEffectId: expectedEvent.effectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
    },
  ]);
}

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
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

function eventShape(kind: "normal" | "special") {
  if (kind === "normal") return { name: "normalSummoned", code: 1100, reason: duelReason.summon, effectId: 1 };
  return { name: "specialSummoned", code: 1102, reason: duelReason.summon | duelReason.specialSummon, effectId: 2 };
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
      e:SetOperation(function(e,tp) Debug.Message("lady debug ${kind} responder resolved") end)
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
