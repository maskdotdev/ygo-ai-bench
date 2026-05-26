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
const horusCode = "36898537";
const tunerCode = "368985370";
const pendulumCode = "368985371";
const targetCode = "368985372";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHorusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${horusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const typePendulum = 0x1000000;
const categoryControl = 0x2000;
const effectFlagDelay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasHorusScript)("Lua real script Metaphys Horus Synchro material control", () => {
  it("restores Synchro material-check labels into Pendulum-material control trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${horusCode}.lua`);
    expect(script).toContain("--Metaphys Horus");
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e1:SetValue(s.valcheck)");
    expect(script).toContain("e4:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e4:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e4:SetLabelObject(e1)");
    expect(script).toContain("(e:GetLabelObject():GetLabel()&TYPE_PENDULUM)~=0");
    expect(script).toContain("Duel.SelectMatchingCard(1-tp,Card.IsControlerCanBeChanged,1-tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.GetControl(tc,tp,nil,nil,nil,1-tp)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36898537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, pendulumCode], extra: [horusCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const horus = requireCard(session, horusCode);
    const tuner = requireCard(session, tunerCode);
    const pendulum = requireCard(session, pendulumCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, pendulum, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(horusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === horus.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, triggerEvent: undefined },
      { category: undefined, code: 251, event: "continuous", property: undefined, triggerEvent: undefined },
      { category: undefined, code: 1102, event: "trigger", property: effectFlagDelay, triggerEvent: "specialSummoned" },
      { category: 0x4000, code: 1102, event: "trigger", property: 0x10 | effectFlagDelay, triggerEvent: "specialSummoned" },
      { category: categoryControl, code: 1102, event: "trigger", property: effectFlagDelay, triggerEvent: "specialSummoned" },
    ]);

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === horus.uid &&
      sameMembers(action.materialUids, [tuner.uid, pendulum.uid])
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, summon!);
    expect(findCard(restoredOpen.session, horus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, pendulum.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
    }))).toEqual([
      { effectId: "lua-6-1102", eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: horus.uid },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === horus.uid && action.effectId === "lua-6-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);
    if (restoredTrigger.session.state.chain.length > 0) {
      expect(restoredTrigger.session.state.chain.map((link) => ({
        effectId: link.effectId,
        sourceUid: link.sourceUid,
        operationInfos: link.operationInfos,
      }))).toEqual([
        {
          effectId: "lua-6-1102",
          sourceUid: horus.uid,
          operationInfos: [{ category: categoryControl, targetUids: [], count: 1, player: 0, parameter: 0 }],
        },
      ]);
      passRestoredChain(restoredTrigger);
    }

    const restoredControlled = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredControlled);
    expectRestoredLegalActions(restoredControlled, restoredControlled.session.state.waitingFor ?? restoredControlled.session.state.turnPlayer);
    expect(findCard(restoredControlled.session, target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: horus.uid,
      reasonEffectId: 6,
    });
    expect(restoredControlled.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 85).map((effect) => ({
      code: effect.code,
      description: effect.description,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { sourceUid: target.uid, code: 85, description: 3206, reset: { flags: 1107169792 } },
    ]);
    expect(restoredControlled.session.state.eventHistory.filter((event) => ["specialSummoned", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: horus.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, currentController: 0, currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: horus.uid, eventReasonEffectId: 6, currentController: 0, currentLocation: "monsterZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: horusCode, name: "Metaphys Horus", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 6, attack: 2300, defense: 1600 },
    { code: tunerCode, name: "Metaphys Horus Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, level: 2, attack: 800, defense: 1000 },
    { code: pendulumCode, name: "Metaphys Horus Pendulum Non-Tuner", kind: "monster", typeFlags: typeMonster | typePendulum, level: 4, attack: 1500, defense: 1200 },
    { code: targetCode, name: "Metaphys Horus Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
