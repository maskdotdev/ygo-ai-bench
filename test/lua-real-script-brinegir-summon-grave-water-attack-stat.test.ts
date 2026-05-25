import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const brinegirCode = "2102065";
const graveWaterCode = "21020650";
const graveFireCode = "21020651";
const fieldWaterCode = "21020652";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBrinegirScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${brinegirCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSeaSerpent = 0x40000;
const attributeWater = 0x2;
const attributeFire = 0x4;
const eventSummonSuccess = 1100;
const eventSpecialSummonSuccess = 1102;
const eventToGrave = 1014;
const effectUpdateAttack = 100;
const effectFlagCardTargetDelay = 65552;
const resetsStandardDisablePhaseEnd = 1107235328;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasBrinegirScript)("Lua real script Brinegir summon grave WATER attack stat", () => {
  it("restores Special Summon success target prompt into self ATK gain from a WATER monster in Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${brinegirCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 2102065, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brinegirCode, graveWaterCode, graveFireCode, fieldWaterCode] }, 1: { main: [] } });
    startDuel(session);

    const brinegir = requireCard(session, brinegirCode);
    const graveWater = requireCard(session, graveWaterCode);
    const graveFire = requireCard(session, graveFireCode);
    const fieldWater = requireCard(session, fieldWaterCode);
    moveDuelCard(session.state, brinegir.uid, "hand", 0);
    moveDuelCard(session.state, graveWater.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, graveFire.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, fieldWater, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(brinegirCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === brinegir.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      optional: effect.optional,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 2097152, code: eventSummonSuccess, event: "trigger", optional: true, property: effectFlagCardTargetDelay, range: ["monsterZone"], sourceUid: brinegir.uid, triggerEvent: "normalSummoned" },
      { category: 2097152, code: eventSpecialSummonSuccess, event: "trigger", optional: true, property: effectFlagCardTargetDelay, range: ["monsterZone"], sourceUid: brinegir.uid, triggerEvent: "specialSummoned" },
      { category: 2097152, code: eventToGrave, event: "trigger", optional: true, property: effectFlagCardTargetDelay, range: allLocations, sourceUid: brinegir.uid, triggerEvent: "sentToGraveyard" },
    ]);

    specialSummonDuelCard(session.state, brinegir.uid, 0, 0);
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: brinegir.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: brinegir.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === brinegir.uid && action.effectId === "lua-2-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, brinegir.uid), restoredTrigger.session.state)).toBe(2800);
    expect(currentAttack(findCard(restoredTrigger.session, fieldWater.uid), restoredTrigger.session.state)).toBe(900);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === brinegir.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: resetsStandardDisablePhaseEnd }, sourceUid: brinegir.uid, value: 1500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: brinegir.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventCardUid: graveWater.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2, previous: "deck", current: "graveyard" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(findCard(restoredAfter.session, brinegir.uid), restoredAfter.session.state)).toBe(2800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Brinegir");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: brinegirCode, name: "Brinegir", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 7, attack: 1300, defense: 1000 },
    { code: graveWaterCode, name: "Brinegir Grave WATER Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
    { code: graveFireCode, name: "Brinegir Grave FIRE Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeFire, level: 4, attack: 2000, defense: 1000 },
    { code: fieldWaterCode, name: "Brinegir Field WATER Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 900, defense: 1000 },
  ];
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
