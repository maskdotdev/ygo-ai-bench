import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const triantisCode = "17825378";
const darkPendulumCode = "178253780";
const targetACode = "178253781";
const targetBCode = "178253782";
const fusionCode = "178253783";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTriantisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${triantisCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typePendulum = 0x1000000;
const racePlant = 0x400;
const attributeDark = 0x20;
const counterPredator = 0x1041;
const effectExtraFusionMaterial = 352;
const effectChangeLevel = 131;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTriantisScript)("Lua real script Predaplant Triantis pzone fusion counter level", () => {
  it("restores Pendulum Zone extra Fusion material and material-trigger Predator Counter Level 1 changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${triantisCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredFusionScenario(reader, workspace);
    const triantis = requireCard(restoredOpen.session, triantisCode);
    const darkPendulum = requireCard(restoredOpen.session, darkPendulumCode);
    const targetA = requireCard(restoredOpen.session, targetACode);
    const targetB = requireCard(restoredOpen.session, targetBCode);
    const fusion = requireCard(restoredOpen.session, fusionCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === triantis.uid && [effectExtraFusionMaterial, eventBeMaterial].includes(effect.code ?? -1)).map(effectSummary)).toEqual([
      {
        category: undefined,
        code: effectExtraFusionMaterial,
        event: "continuous",
        optional: undefined,
        property: undefined,
        range: ["spellTrapZone"],
        sourceUid: triantis.uid,
        targetRange: [0x200, 0],
        triggerEvent: undefined,
      },
      {
        category: 0x800000,
        code: eventBeMaterial,
        event: "trigger",
        optional: true,
        property: 65536,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        sourceUid: triantis.uid,
        targetRange: undefined,
        triggerEvent: "usedAsMaterial",
      },
    ]);
    fusionSummonDuelCard(restoredOpen.session.state, 0, fusion.uid, [triantis.uid, darkPendulum.uid]);
    expect(findCard(restoredOpen.session, fusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [triantis.uid, darkPendulum.uid],
    });
    expect(findCard(restoredOpen.session, triantis.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.material | duelReason.fusion,
      reasonPlayer: 0,
      reasonCardUid: fusion.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: triantis.uid,
        eventPlayer: 0,
        eventReason: duelReason.fusion,
        eventReasonCardUid: fusion.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 1 },
        sourceUid: triantis.uid,
        effectId: "lua-4-1108",
        player: 0,
        eventTriggerTiming: "if",
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    activateTrigger(restoredTrigger, triantis.uid, "lua-4-1108");
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, targetA.uid), counterPredator)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, targetB.uid), counterPredator)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, fusion.uid), counterPredator)).toBe(1);
    expect(currentLevel(findCard(restoredTrigger.session, targetA.uid), restoredTrigger.session.state)).toBe(1);
    expect(currentLevel(findCard(restoredTrigger.session, targetB.uid), restoredTrigger.session.state)).toBe(1);
    expect(currentLevel(findCard(restoredTrigger.session, fusion.uid), restoredTrigger.session.state)).toBe(1);
    expect(restoredTrigger.session.state.effects.filter((effect) => [targetA.uid, targetB.uid, fusion.uid].includes(effect.sourceUid) && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: targetA.uid, value: 1 },
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: targetB.uid, value: 1 },
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: fusion.uid, value: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: triantis.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: fusion.uid, eventReasonEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: darkPendulum.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: fusion.uid, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triantis.uid, eventReasonEffectId: 4 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: targetB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triantis.uid, eventReasonEffectId: 4 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: fusion.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triantis.uid, eventReasonEffectId: 4 },
    ]);

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(finalRestore);
    expectRestoredLegalActions(finalRestore, 0);
    expect(currentLevel(findCard(finalRestore.session, targetA.uid), finalRestore.session.state)).toBe(1);
    expect(currentLevel(findCard(finalRestore.session, targetB.uid), finalRestore.session.state)).toBe(1);
    expect(currentLevel(findCard(finalRestore.session, fusion.uid), finalRestore.session.state)).toBe(1);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const triantis = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === triantisCode);
  expect(triantis).toBeDefined();
  return [
    triantis!,
    { code: darkPendulumCode, name: "Triantis DARK Pendulum Material", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: racePlant, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
    { code: targetACode, name: "Triantis Predator Counter Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: targetBCode, name: "Triantis Predator Counter Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 3, attack: 1400, defense: 1000 },
    { code: fusionCode, name: "Triantis Fixture Fusion", kind: "extra", typeFlags: typeMonster | typeFusion | typeEffect, race: racePlant, attribute: attributeDark, level: 6, attack: 2200, defense: 1800, fusionMaterials: [triantisCode, darkPendulumCode] },
  ];
}

function createRestoredFusionScenario(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17825378, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [triantisCode, darkPendulumCode, targetACode, targetBCode], extra: [fusionCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpPzone(session, requireCard(session, triantisCode), 0);
  moveFaceUpPzone(session, requireCard(session, darkPendulumCode), 1);
  moveFaceUpAttack(session, requireCard(session, targetACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetBCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(triantisCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplant Triantis");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_FUSION_MATERIAL)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_PZONE,0)");
  expect(script).toContain("e1:SetValue(function(_,c) return c and c:IsAttribute(ATTRIBUTE_DARK) end)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("(r&REASON_FUSION)==REASON_FUSION and c:IsFaceup()");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,max,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
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

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function effectSummary(effect: { sourceUid: string; code?: number; event?: string; optional?: boolean; property?: number; category?: number; range?: string[]; targetRange?: [number, number?]; triggerEvent?: string }) {
  return {
    category: effect.category,
    code: effect.code,
    event: effect.event,
    optional: effect.optional,
    property: effect.property,
    range: effect.range,
    sourceUid: effect.sourceUid,
    targetRange: effect.targetRange,
    triggerEvent: effect.triggerEvent,
  };
}

function activateTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, effectId: string): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const trigger = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "activateTrigger" && action.uid === uid && action.effectId === effectId
  );
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, trigger!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
