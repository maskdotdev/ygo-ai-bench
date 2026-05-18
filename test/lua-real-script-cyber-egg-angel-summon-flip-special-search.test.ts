import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
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
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Egg Angel summon, flip, and special summon search", () => {
  it("restores its delayed cloned summon triggers into a Machine Angel Spell search and confirmation", () => {
    assertCyberEggSearch("normal");
    assertCyberEggSearch("flip");
    assertCyberEggSearch("special");
  });
});

function assertCyberEggSearch(kind: "normal" | "flip" | "special"): void {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const cyberEggCode = "28053106";
  const machineAngelRitualCode = "39996157";
  const decoySpellCode = "28053110";
  const responderCode = kind === "normal" ? "28053107" : kind === "flip" ? "28053108" : "28053109";
  const script = workspace.readScript(`c${cyberEggCode}.lua`);
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("local e2=e1:Clone()");
  expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("local e3=e1:Clone()");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return ((c:IsSetCard(SET_MACHINE_ANGEL) and c:IsSpell()) or c:IsCode(95658967)) and c:IsAbleToHand()");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [cyberEggCode, machineAngelRitualCode].includes(card.code)),
    { code: decoySpellCode, name: "Cyber Egg Angel Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
    { code: responderCode, name: `Cyber Egg Angel ${kind} Chain Responder`, kind: "monster", typeFlags: typeMonster, level: 4 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: kind === "normal" ? 28053106 : kind === "flip" ? 28053108 : 28053109, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cyberEggCode, machineAngelRitualCode, decoySpellCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  const cyberEgg = requireCard(session.state.cards, cyberEggCode);
  const machineAngelRitual = requireCard(session.state.cards, machineAngelRitualCode);
  const decoySpell = requireCard(session.state.cards, decoySpellCode);
  const responder = requireCard(session.state.cards, responderCode);
  const initialCyberEggState = cardEventState(cyberEgg);
  if (kind === "flip") {
    const movedCyberEgg = moveDuelCard(session.state, cyberEgg.uid, "monsterZone", 0);
    movedCyberEgg.position = "faceDownDefense";
    movedCyberEgg.faceUp = false;
  } else {
    moveDuelCard(session.state, cyberEgg.uid, "hand", 0);
  }
  moveDuelCard(session.state, responder.uid, "hand", 1);
  session.state.turn = kind === "normal" ? 2 : kind === "flip" ? 4 : 6;
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
  expect(host.loadCardScript(Number(cyberEggCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const cyberEggBefore = requireCard(session.state.cards, cyberEggCode);
  const previousCyberEggState = kind === "flip" ? initialCyberEggState : cardEventState(cyberEggBefore);
  const currentCyberEggState = { ...previousCyberEggState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };
  let triggerWindowSnapshot = serializeDuel(session);
  if (kind === "normal" || kind === "flip") {
    const restoredOpen = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const actionType = kind === "normal" ? "normalSummon" : "flipSummon";
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === actionType && action.uid === cyberEgg.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    triggerWindowSnapshot = serializeDuel(restoredOpen.session);
  } else {
    specialSummonDuelCard(session.state, cyberEgg.uid, 0);
    triggerWindowSnapshot = serializeDuel(session);
  }

  const restoredTriggerWindow = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
  expectCleanRestore(restoredTriggerWindow);
  expectRestoredLegalActions(restoredTriggerWindow, 0);
  const expectedEvent = eventShape(kind);
  expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
    {
      id: "trigger-3-1",
      effectId: `lua-${expectedEvent.effectId}-${expectedEvent.code}`,
      sourceUid: cyberEgg.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: cyberEgg.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventTriggerTiming: "if",
      eventPreviousState: previousCyberEggState,
      eventCurrentState: currentCyberEggState,
    },
  ]);
  const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === cyberEgg.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
  expect(restoredTriggerWindow.session.state.chain).toEqual([
    {
      id: "chain-3",
      chainIndex: 1,
      effectId: `lua-${expectedEvent.effectId}-${expectedEvent.code}`,
      sourceUid: cyberEgg.uid,
      player: 0,
      activationLocation: "monsterZone",
      activationSequence: 0,
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: cyberEgg.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventTriggerTiming: "if",
      eventPreviousState: previousCyberEggState,
      eventCurrentState: currentCyberEggState,
      operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
    },
  ]);

  const targetPreviousState = cardEventState(machineAngelRitual);
  const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
  expectCleanRestore(restoredSearchChain);
  expectRestoredLegalActions(restoredSearchChain, 1);
  expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  const pass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredSearchChain, pass!);

  expect(restoredSearchChain.session.state.chain).toEqual([]);
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === cyberEgg.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === machineAngelRitual.uid)).toMatchObject({ location: "hand", controller: 0 });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoySpell.uid)).toMatchObject({ location: "deck", controller: 0 });
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
  expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${machineAngelRitualCode}`]);
  expect(restoredSearchChain.host.messages).not.toContain(`cyber egg angel ${kind} responder resolved`);
  expect(
    restoredSearchChain.session.state.eventHistory.filter((event) =>
      [expectedEvent.name, "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
    ),
  ).toEqual([
    {
      eventName: expectedEvent.name,
      eventCode: expectedEvent.code,
      eventCardUid: cyberEgg.uid,
      eventReason: expectedEvent.reason,
      eventReasonPlayer: 0,
      eventPreviousState: previousCyberEggState,
      eventCurrentState: currentCyberEggState,
    },
    {
      eventName: "sentToHand",
      eventCode: 1012,
      eventCardUid: machineAngelRitual.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: cyberEgg.uid,
      eventReasonEffectId: expectedEvent.effectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "confirmed",
      eventCode: 1211,
      eventPlayer: 1,
      eventUids: [machineAngelRitual.uid],
      eventValue: 1,
      eventCardUid: machineAngelRitual.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: cyberEgg.uid,
      eventReasonEffectId: expectedEvent.effectId,
      eventPreviousState: targetPreviousState,
      eventCurrentState: { ...targetPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "sentToHandConfirmed",
      eventCode: 1212,
      eventPlayer: 1,
      eventUids: [machineAngelRitual.uid],
      eventValue: 1,
      eventCardUid: machineAngelRitual.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: cyberEgg.uid,
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

function eventShape(kind: "normal" | "flip" | "special") {
  if (kind === "normal") return { name: "normalSummoned", code: 1100, reason: duelReason.summon, effectId: 1 };
  if (kind === "flip") return { name: "flipSummoned", code: 1101, reason: 0, effectId: 2 };
  return { name: "specialSummoned", code: 1102, reason: duelReason.summon | duelReason.specialSummon, effectId: 3 };
}

function chainResponderScript(kind: "normal" | "flip" | "special"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("cyber egg angel ${kind} responder resolved") end)
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
