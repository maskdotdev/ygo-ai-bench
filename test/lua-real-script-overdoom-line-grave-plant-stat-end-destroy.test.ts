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
const overdoomCode = "87046457";
const plantCode = "870464570";
const nonPlantCode = "870464571";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOverdoomScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${overdoomCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const specialSummonedEvent = 1102;
const phaseEndEvent = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasOverdoomScript)("Lua real script Overdoom Line grave Plant stat end destroy", () => {
  it("restores SetTargetCard Special Summon tracking into Plant ATK boost and self End Phase destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${overdoomCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const { restored, overdoom, plant, nonPlant } = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === overdoom.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === overdoom.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === overdoom.uid && effect.code === phaseEndEvent).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: phaseEndEvent, countLimit: 1, event: "continuous", range: ["spellTrapZone"], reset: { flags: 0x51fe1200, count: 2 }, sourceUid: overdoom.uid },
    ]);

    specialSummonDuelCard(restored.session.state, plant.uid, 0, 0, { eventReasonCardUid: overdoom.uid, eventReasonEffectId: 1 });
    specialSummonDuelCard(restored.session.state, nonPlant.uid, 0, 0, { eventReasonCardUid: overdoom.uid, eventReasonEffectId: 1 });
    expect(restored.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: plant.uid,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: overdoom.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: overdoom.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === overdoom.uid && action.effectId === "lua-2-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === plant.uid), restoredBoost.session.state)).toBe(1800);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === nonPlant.uid), restoredBoost.session.state)).toBe(900);
    expect(restoredBoost.session.state.flagEffects.filter((flag) => flag.code === Number(overdoomCode)).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      reset: flag.reset,
      resetCount: flag.resetCount,
      value: flag.value,
    }))).toEqual([
      { code: Number(overdoomCode), ownerId: overdoom.uid, ownerType: "card", reset: 0x1ff1000, resetCount: 1, value: 0 },
      { code: Number(overdoomCode), ownerId: plant.uid, ownerType: "card", reset: 0x1fe1000, resetCount: 1, value: 0 },
    ]);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === overdoom.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 4], value: 1000 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: plant.uid, eventCode: specialSummonedEvent, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: overdoom.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
      { eventCardUid: nonPlant.uid, eventCode: specialSummonedEvent, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: overdoom.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: overdoomCode, name: "Overdoom Line", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: plantCode, name: "Overdoom Plant", kind: "monster", typeFlags: typeMonster | typeNormal, race: racePlant, attribute: attributeEarth, level: 4, attack: 800, defense: 1200 },
    { code: nonPlantCode, name: "Overdoom Non-Plant", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 900 },
  ];
}

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  overdoom: DuelCardInstance;
  plant: DuelCardInstance;
  nonPlant: DuelCardInstance;
} {
  const session = createDuel({ seed: 87046457, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [overdoomCode, plantCode, nonPlantCode] }, 1: { main: [] } });
  startDuel(session);
  const overdoom = requireCard(session, overdoomCode);
  const plant = requireCard(session, plantCode);
  const nonPlant = requireCard(session, nonPlantCode);
  const setTrap = moveDuelCard(session.state, overdoom.uid, "spellTrapZone", 0);
  setTrap.faceUp = false;
  setTrap.position = "faceDown";
  moveDuelCard(session.state, plant.uid, "graveyard", 0, duelReason.effect, 0);
  moveDuelCard(session.state, nonPlant.uid, "graveyard", 0, duelReason.effect, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(overdoomCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader), overdoom, plant, nonPlant };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Overdoom Line");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD_DISABLE,0,1)");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return e:GetLabelObject():IsContains(c) and c:GetFlagEffect(id)~=0");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("c:SetTurnCounter(0)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
