import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sonicCode = "17932494";
const sendSpellCode = "179324940";
const lowLevelCode = "179324941";
const highLevelCode = "179324942";
const opponentLowLevelCode = "179324943";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSonicScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sonicCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const eventToGrave = 1014;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasSonicScript)("Lua real script Sonic Warrior to-Grave low-level stat", () => {
  it("restores hand EVENT_TO_GRAVE into face-up Level 2 or lower ATK updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sonicCode}.lua`);
    expectScriptShape(script);
    const source = sourceWithSendSpell(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 17932494, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sonicCode, sendSpellCode, lowLevelCode, highLevelCode] }, 1: { main: [opponentLowLevelCode] } });
    startDuel(session);

    const sonic = requireCard(session, sonicCode);
    const sendSpell = requireCard(session, sendSpellCode);
    const lowLevel = requireCard(session, lowLevelCode);
    const highLevel = requireCard(session, highLevelCode);
    const opponentLowLevel = requireCard(session, opponentLowLevelCode);
    moveDuelCard(session.state, sonic.uid, "hand", 0);
    moveDuelCard(session.state, sendSpell.uid, "hand", 0);
    moveFaceUpAttack(session, lowLevel, 0, 0);
    moveFaceUpAttack(session, highLevel, 0, 1);
    moveFaceUpAttack(session, opponentLowLevel, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(sonicCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sendSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === sonic.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 2097152, code: eventToGrave, event: "trigger", sourceUid: sonic.uid, triggerEvent: "sentToGraveyard" },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const send = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sendSpell.uid);
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, send!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, sonic.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sendSpell.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1014",
        eventCardUid: sonic.uid,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect,
        eventReasonCardUid: sendSpell.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: sonic.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === sonic.uid && action.effectId === "lua-1-1014"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, lowLevel.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(findCard(restoredTrigger.session, highLevel.uid), restoredTrigger.session.state)).toBe(1500);
    expect(currentAttack(findCard(restoredTrigger.session, opponentLowLevel.uid), restoredTrigger.session.state)).toBe(700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === lowLevel.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: resetEventStandard }, sourceUid: lowLevel.uid, value: 500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: sonic.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: sendSpell.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
      { eventCardUid: sendSpell.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(findCard(restoredAfter.session, lowLevel.uid), restoredAfter.session.state)).toBe(1300);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Sonic Warrior");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsLevelBelow,2),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: sonicCode, name: "Sonic Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 2, attack: 1000, defense: 0 },
    { code: sendSpellCode, name: "Sonic Warrior Send Spell", kind: "spell", typeFlags: typeSpell },
    { code: lowLevelCode, name: "Sonic Warrior Low-Level Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 2, attack: 800, defense: 1000 },
    { code: highLevelCode, name: "Sonic Warrior High-Level Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 3, attack: 1500, defense: 1000 },
    { code: opponentLowLevelCode, name: "Sonic Warrior Opponent Low-Level", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 2, attack: 700, defense: 1000 },
  ];
}

function sourceWithSendSpell(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${sendSpellCode}.lua`) return sendSonicScript();
      return workspace.readScript(name);
    },
  };
}

function sendSonicScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp)
      local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sonicCode}),tp,LOCATION_HAND,0,nil)
      if tc then Duel.SendtoGrave(tc,REASON_EFFECT) end
    end
  `;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
