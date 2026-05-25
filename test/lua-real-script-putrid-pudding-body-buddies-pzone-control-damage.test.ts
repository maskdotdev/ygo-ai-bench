import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const putridCode = "85101097";
const pzoneTargetCode = "851010970";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPutridScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${putridCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceAqua = 0x40;
const attributeDark = 0x20;
const categoryDestroy = 0x1;
const categoryControl = 0x2000;
const categoryDamage = 0x80000;
const effectFlagSingleRange = 131072;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const effectUnreleasableSum = 43;
const effectUnreleasableNonsum = 44;
const effectCannotBeFusionMaterial = 235;
const effectCannotBeSynchroMaterial = 236;
const effectCannotBeXyzMaterial = 238;

describe.skipIf(!hasUpstreamScripts || !hasPutridScript)("Lua real script Putrid Pudding Body Buddies PZone control damage", () => {
  it("restores release/material locks plus End Phase PZone destroy-control and Standby damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${putridCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredPutridField({ reader, workspace, turnPlayer: 0, phase: "main2" });
    const putrid = requireCard(restoredOpen.session, putridCode);
    const target = requireCard(restoredOpen.session, pzoneTargetCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === putrid.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectUnreleasableSum, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectUnreleasableNonsum, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectCannotBeFusionMaterial, countLimit: undefined, event: "continuous", property: effectFlagCannotDisable, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectCannotBeSynchroMaterial, countLimit: undefined, event: "continuous", property: effectFlagCannotDisable, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectCannotBeXyzMaterial, countLimit: undefined, event: "continuous", property: effectFlagCannotDisable, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined, value: 1 },
      { category: categoryDestroy | categoryControl, code: 4608, countLimit: 1, event: "trigger", property: effectFlagCardTarget, range: ["monsterZone"], triggerEvent: "phaseEnd", value: undefined },
      { category: categoryDamage, code: 4098, countLimit: 1, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "phaseStandby", value: undefined },
    ]);

    const end = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, end!);
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-6-4608",
        sourceUid: putrid.uid,
        eventName: "phaseEnd",
        eventCode: 4608,
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    const control = getLuaRestoreLegalActions(restoredEndTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === putrid.uid && action.effectId === "lua-6-4608"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndTrigger, control!);
    passRestoredChain(restoredEndTrigger);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: putrid.uid,
      reasonEffectId: 6,
    });
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === putrid.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: putrid.uid,
      reasonEffectId: 6,
    });
    expect(restoredEndTrigger.session.state.eventHistory.filter((event) => ["phaseEnd", "becameTarget", "destroyed", "controlChanged"].includes(event.eventName))).toEqual([
      { eventName: "phaseEnd", eventCode: 4608 },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 6,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: putrid.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: putrid.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: putrid.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    restoredEndTrigger.session.state.phase = "draw";
    restoredEndTrigger.session.state.turnPlayer = 1;
    restoredEndTrigger.session.state.waitingFor = 1;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredEndTrigger.session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    const standby = getLuaRestoreLegalActions(restoredDraw, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 1,
        effectId: "lua-7-4098",
        sourceUid: putrid.uid,
        eventName: "phaseStandby",
        eventCode: 4098,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 1);
    const damage = getLuaRestoreLegalActions(restoredDamageTrigger, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === putrid.uid && action.effectId === "lua-7-4098"
    );
    expect(damage, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageTrigger, damage!);
    passRestoredChain(restoredDamageTrigger);
    expect(restoredDamageTrigger.session.state.players[1].lifePoints).toBe(7700);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "damageDealt"].includes(event.eventName))).toEqual([
      { eventName: "phaseStandby", eventCode: 4098 },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: putrid.uid,
        eventReasonEffectId: 7,
      },
    ]);
    expect(restoredDamageTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Putrid Pudding Body Buddies");
  expect(script).toContain("e1:SetCode(EFFECT_UNRELEASABLE_SUM)");
  expect(script).toContain("e2:SetCode(EFFECT_UNRELEASABLE_NONSUM)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_BE_FUSION_MATERIAL)");
  expect(script).toContain("e4:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)");
  expect(script).toContain("e5:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)");
  expect(script).toContain("e6:SetCategory(CATEGORY_DESTROY+CATEGORY_CONTROL)");
  expect(script).toContain("e6:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_PZONE,0,1,1,nil)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e7:SetCategory(CATEGORY_DAMAGE)");
  expect(script).toContain("e7:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.Damage(tp,300,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: putridCode, name: "Putrid Pudding Body Buddies", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 1, attack: 300, defense: 300 },
    { code: pzoneTargetCode, name: "Putrid Pudding PZone Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceAqua, attribute: attributeDark, level: 4, attack: 1200, defense: 1200, leftScale: 1, rightScale: 1 },
  ];
}

function createRestoredPutridField({
  reader,
  workspace,
  phase,
  turnPlayer,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  phase: DuelSession["state"]["phase"];
  turnPlayer: PlayerId;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 85101097, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [putridCode, pzoneTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, putridCode), 0, 0);
  movePendulumZone(session, requireCard(session, pzoneTargetCode), 0, 0);
  session.state.turn = 2;
  session.state.phase = phase;
  session.state.turnPlayer = turnPlayer;
  session.state.waitingFor = turnPlayer;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(putridCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function movePendulumZone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
