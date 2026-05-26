import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yellow Gadget summon and special summon search", () => {
  it("restores its cloned normal-summon and special-summon search triggers without selection prompts", () => {
    assertYellowGadgetSearch("normal");
    assertYellowGadgetSearch("special");
  });
});

function assertYellowGadgetSearch(kind: "normal" | "special"): void {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const yellowGadgetCode = "13839120";
  const greenGadgetCode = "41172955";
  const redGadgetCode = "86445415";
  const responderCode = kind === "normal" ? "13839121" : "13839122";
  const script = workspace.readScript(`c${yellowGadgetCode}.lua`);
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_O+EFFECT_TYPE_SINGLE)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("local e2=e1:Clone()");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsCode(41172955) and c:IsAbleToHand()");
  expect(script).toContain("Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");

  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [yellowGadgetCode, greenGadgetCode, redGadgetCode].includes(card.code)),
    { code: responderCode, name: `Yellow Gadget ${kind} Chain Responder`, kind: "monster", typeFlags: typeMonster, level: 4 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: kind === "normal" ? 13839120 : 13839122, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [yellowGadgetCode, greenGadgetCode, redGadgetCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  const yellow = requireCard(session.state.cards, yellowGadgetCode);
  const green = requireCard(session.state.cards, greenGadgetCode);
  const red = requireCard(session.state.cards, redGadgetCode);
  const responder = requireCard(session.state.cards, responderCode);
  moveDuelCard(session.state, yellow.uid, "hand", 0);
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
  expect(host.loadCardScript(Number(yellowGadgetCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  let triggerWindowSnapshot = serializeDuel(session);
  let previousYellowState = cardEventState(yellow);
  let currentYellowState = { ...previousYellowState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 };
  if (kind === "normal") {
    const restoredSummonWindow = restoreDuelWithLuaScripts(triggerWindowSnapshot, source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === yellow.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);
    triggerWindowSnapshot = serializeDuel(restoredSummonWindow.session);
  } else {
    specialSummonDuelCard(session.state, yellow.uid, 0);
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
    sourceUid: yellow.uid,
    player: 0,
    triggerBucket: "turnOptional",
    eventName: kind === "normal" ? "normalSummoned" : "specialSummoned",
    eventCode: kind === "normal" ? 1100 : 1102,
    eventCardUid: yellow.uid,
    eventPlayer: 0,
    eventReason: kind === "normal" ? duelReason.summon : duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventTriggerTiming: "when",
    eventPreviousState: previousYellowState,
    eventCurrentState: currentYellowState,
  });
  const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === yellow.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
  expect(restoredTriggerWindow.session.state.chain).toEqual([
    {
      id: "chain-3",
      chainIndex: 1,
      effectId: pendingTrigger.effectId,
      sourceUid: yellow.uid,
      player: 0,
      activationLocation: "monsterZone",
      activationSequence: 0,
      eventName: kind === "normal" ? "normalSummoned" : "specialSummoned",
      eventCode: kind === "normal" ? 1100 : 1102,
      eventCardUid: yellow.uid,
      eventPlayer: 0,
      eventReason: kind === "normal" ? duelReason.summon : duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      eventPreviousState: previousYellowState,
      eventCurrentState: currentYellowState,
      operationInfos: [{ category: 8, count: 1, parameter: 1, player: 0, targetUids: [] }],
    },
  ]);

  const greenPreviousState = cardEventState(green);
  const searchEffectId = kind === "normal" ? 1 : 2;
  const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
  expectCleanRestore(restoredSearchChain);
  expectRestoredLegalActions(restoredSearchChain, 1);
  const pass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
  const resolved = applyLuaRestoreResponse(restoredSearchChain, pass!);
  expect(resolved.ok, resolved.error).toBe(true);

  const resolvedGreen = restoredSearchChain.session.state.cards.find((card) => card.uid === green.uid);
  expect(resolvedGreen?.controller).toBe(0);
  expect(resolvedGreen?.location).toBe("hand");
  expect(resolvedGreen?.sequence).toBe(0);
  expect(restoredSearchChain.session.state.cards.find((card) => card.uid === red.uid)?.location).toBe("deck");
  expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${greenGadgetCode}`]);
  expect(restoredSearchChain.host.messages).not.toContain(`yellow gadget ${kind} responder resolved`);
  expect(
    restoredSearchChain.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
    ),
  ).toEqual([
    {
      eventName: "sentToHand",
      eventCode: 1012,
      eventCardUid: green.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: yellow.uid,
      eventReasonEffectId: searchEffectId,
      eventPreviousState: greenPreviousState,
      eventCurrentState: { ...greenPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "confirmed",
      eventCode: 1211,
      eventPlayer: 1,
      eventUids: [green.uid],
      eventValue: 1,
      eventCardUid: green.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: yellow.uid,
      eventReasonEffectId: searchEffectId,
      eventPreviousState: greenPreviousState,
      eventCurrentState: { ...greenPreviousState, location: "hand", sequence: 0 },
    },
    {
      eventName: "sentToHandConfirmed",
      eventCode: 1212,
      eventPlayer: 1,
      eventUids: [green.uid],
      eventValue: 1,
      eventCardUid: green.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: yellow.uid,
      eventReasonEffectId: searchEffectId,
      eventPreviousState: greenPreviousState,
      eventCurrentState: { ...greenPreviousState, location: "hand", sequence: 0 },
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

function chainResponderScript(kind: "normal" | "special"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("yellow gadget ${kind} responder resolved") end)
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
  }
}
