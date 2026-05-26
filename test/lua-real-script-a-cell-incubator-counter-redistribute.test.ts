import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const incubatorCode = "64163367";
const removerCode = "641633670";
const targetACode = "641633671";
const targetBCode = "641633672";
const opponentTargetCode = "641633673";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIncubatorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${incubatorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceReptile = 0x80000;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasIncubatorScript)("Lua real script A Cell Incubator counter redistribute", () => {
  it("restores A-Counter remove tracking and destroyed Incubator counter redistribution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${incubatorCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 64163367, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [incubatorCode, removerCode, targetACode, targetBCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const incubator = requireCard(session, incubatorCode);
    const remover = requireCard(session, removerCode);
    const targetA = requireCard(session, targetACode);
    const targetB = requireCard(session, targetBCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpSpell(session, incubator, 0, 0);
    moveDuelCard(session.state, remover.uid, "hand", 0);
    moveFaceUpAttack(session, targetA, 0, 0);
    moveFaceUpAttack(session, targetB, 0, 1);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    expect(addDuelCardCounter(targetA, counterA, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    for (const code of [incubatorCode, removerCode, targetACode, targetBCode, opponentTargetCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(5);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const remove = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === remover.uid);
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    const removeAction = remove as Extract<DuelAction, { type: "activateEffect" }>;
    applyRestoredActionAndAssert(restoredOpen, remove!);
    resolveRestoredChain(restoredOpen);

    expect(getDuelCardCounter(findCard(restoredOpen.session, targetA.uid), counterA)).toBe(0);
    expect(getDuelCardCounter(findCard(restoredOpen.session, incubator.uid), counterA)).toBe(1);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["counterRemoved", "counterAdded"].includes(event.eventName))).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: targetA.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: remover.uid,
        eventReasonEffectId: luaEffectNumber(removeAction.effectId),
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: incubator.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: incubator.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyEventStart = restoredDestroy.session.state.eventHistory.length;
    expect(addDuelCardCounter(findCard(restoredDestroy.session, incubator.uid), counterA, 1)).toBe(true);
    destroyDuelCard(restoredDestroy.session.state, incubator.uid, 0, duelReason.effect | duelReason.destroy, 0);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) => action.type === "activateTrigger" && action.uid === incubator.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyedTrigger!);
    resolveRestoredChain(restoredDestroy);

    expect(findCard(restoredDestroy.session, incubator.uid)).toMatchObject({ location: "graveyard" });
    expect(getDuelCardCounter(findCard(restoredDestroy.session, targetA.uid), counterA)).toBe(2);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, targetB.uid), counterA)).toBe(0);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, opponentTarget.uid), counterA)).toBe(0);
    expect(restoredDestroy.session.state.eventHistory.slice(destroyEventStart).filter((event) => ["leftField", "destroyed", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "leftField", eventCode: 1015, eventCardUid: incubator.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: incubator.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: incubator.uid, eventReasonEffectId: 4, previous: "deck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: incubator.uid, eventReasonEffectId: 4, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: incubatorCode, name: "\"A\" Cell Incubator", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: removerCode, name: "A Cell Incubator Counter Remover", kind: "spell", typeFlags: typeSpell },
    { code: targetACode, name: "A Cell Incubator Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1000, defense: 1000 },
    { code: targetBCode, name: "A Cell Incubator Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "A Cell Incubator Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1000, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${removerCode}.lua`) return removerScript(targetACode);
      if (name === `c${targetACode}.lua` || name === `c${targetBCode}.lua` || name === `c${opponentTargetCode}.lua`) return counterTargetScript();
      return workspace.readScript(name);
    },
  };
}

function removerScript(targetCode: string): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_ACTIVATE)
  e:SetCode(EVENT_FREE_CHAIN)
  e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
    if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil,tp) end
  end)
  e:SetOperation(function(e,tp)
    local tc=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil,tp):GetFirst()
    if tc then tc:RemoveCounter(tp,COUNTER_A,1,REASON_EFFECT) end
  end)
  c:RegisterEffect(e)
end
function s.filter(c,tp)
  return c:IsCode(${targetCode}) and c:GetCounter(COUNTER_A)>0
end
`;
}

function counterTargetScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  c:EnableCounterPermit(COUNTER_A)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("\"A\" Cell Incubator");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE_COUNTER+COUNTER_A)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_A,1)");
  expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD_P)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("local ct=e:GetHandler():GetCounter(COUNTER_A)");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e4:SetLabelObject(e3)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
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

function luaEffectNumber(effectId: string | undefined): number | undefined {
  const match = effectId?.match(/^lua-(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
}): object {
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (;;) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    if (!action) return;
    applyRestoredActionAndAssert(restored, action);
  }
}
