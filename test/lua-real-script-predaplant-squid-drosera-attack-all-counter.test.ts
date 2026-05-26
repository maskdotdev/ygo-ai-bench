import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const squidCode = "69105797";
const allyTargetCode = "691057970";
const opponentSpecialCode = "691057971";
const opponentNormalCode = "691057972";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSquidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${squidCode}.lua`));
const predatorCounter = 0x1041;
const effectAttackAll = 193;
const effectChangeLevel = 131;
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSquidScript)("Lua real script Predaplant Squid Drosera attack-all counter", () => {
  it("restores hand self-to-Grave attack-all targeting and leave-field Predator Counter level changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${squidCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const handSession = createSession(reader);
    const handSquid = requireCard(handSession, squidCode);
    const allyTarget = requireCard(handSession, allyTargetCode);
    moveDuelCard(handSession.state, handSquid.uid, "hand", 0);
    moveFaceUpAttack(handSession, allyTarget, 0, 0, "normal");
    primeMainPhase(handSession);
    const handHost = createLuaScriptHost(handSession, workspace);
    expect(handHost.loadCardScript(Number(squidCode), workspace).ok).toBe(true);
    expect(handHost.registerInitialEffects()).toBe(1);

    const restoredHand = restoreDuelWithLuaScripts(serializeDuel(handSession), workspace, reader);
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    applyRestoredActionAndAssert(restoredHand, requireAction(restoredHand, handSquid.uid, "activateEffect"));
    expect(findCard(restoredHand.session, handSquid.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handSquid.uid,
      reasonEffectId: 1,
    });
    expect(restoredHand.session.state.effects.filter((effect) => effect.sourceUid === allyTarget.uid && effect.code === effectAttackAll).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
    }))).toEqual([{ code: effectAttackAll, event: "continuous", reset: { flags: 1107169792 } }]);
    expect(restoredHand.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handSquid.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: handSquid.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
    ]);

    const fieldSession = createSession(reader);
    const fieldSquid = requireCard(fieldSession, squidCode);
    const opponentSpecial = requireCard(fieldSession, opponentSpecialCode);
    const opponentNormal = requireCard(fieldSession, opponentNormalCode);
    moveFaceUpAttack(fieldSession, fieldSquid, 0, 0, "normal");
    moveFaceUpAttack(fieldSession, opponentSpecial, 1, 0, "special");
    moveFaceUpAttack(fieldSession, opponentNormal, 1, 1, "normal");
    primeMainPhase(fieldSession);
    const fieldHost = createLuaScriptHost(fieldSession, workspace);
    expect(fieldHost.loadCardScript(Number(squidCode), workspace).ok).toBe(true);
    expect(fieldHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(fieldSession.state, fieldSquid.uid, 0, duelReason.effect | duelReason.destroy, 1);

    const restoredLeave = restoreDuelWithLuaScripts(serializeDuel(fieldSession), workspace, reader);
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 0);
    const trigger = getLuaRestoreLegalActions(restoredLeave, 0).find((action) => action.type === "activateTrigger" && action.uid === fieldSquid.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, trigger!);
    expect(restoredLeave.session.state.chain).toEqual([]);
    expect(getDuelCardCounter(findCard(restoredLeave.session, opponentSpecial.uid), predatorCounter)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredLeave.session, opponentNormal.uid), predatorCounter)).toBe(0);
    expect(currentLevel(findCard(restoredLeave.session, opponentSpecial.uid), restoredLeave.session.state)).toBe(1);
    expect(currentLevel(findCard(restoredLeave.session, opponentNormal.uid), restoredLeave.session.state)).toBe(4);
    expect(restoredLeave.session.state.eventHistory.filter((event) => event.eventName === "counterAdded").map(slimEvent)).toEqual([
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentSpecial.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fieldSquid.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredLeave.session.state.effects.filter((effect) => effect.sourceUid === opponentSpecial.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, value: 1 }]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const squid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === squidCode);
  expect(squid).toBeDefined();
  return [
    squid!,
    monster(allyTargetCode, "Squid Drosera Ally Attack-All Target"),
    monster(opponentSpecialCode, "Squid Drosera Opponent Special"),
    monster(opponentNormalCode, "Squid Drosera Opponent Normal"),
  ];
}

function monster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 };
}

function createSession(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 69105797, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [squidCode, allyTargetCode] }, 1: { main: [opponentSpecialCode, opponentNormalCode] } });
  startDuel(session);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Predaplant Squid Drosera");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return Duel.IsAbleToEnterBP()");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_ATTACK_ALL)");
  expect(script).toContain("return c:GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("s.counter_place_list={COUNTER_PREDATOR}");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("return c:IsPreviousPosition(POS_FACEUP) and not c:IsLocation(LOCATION_DECK)");
  expect(script).toContain("return c:IsFaceup() and c:IsSpecialSummoned()");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
}

function primeMainPhase(session: DuelSession): void {
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, summonType: NonNullable<DuelCardInstance["summonType"]>): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.summonType = summonType;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
