import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { CardPosition, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const uruquizasCode = "53714009";
const tunerCode = "537140090";
const nonTunerCode = "537140091";
const defenseTargetCode = "537140092";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUruquizasScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${uruquizasCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const racePyro = 0x80;
const attributeFire = 0x4;
const effectPierce = 203;
const effectUpdateAttack = 100;
const eventBattleDamage = 1143;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUruquizasScript)("Lua real script Flamvell Uruquizas pierce battle damage stat", () => {
  it("restores Synchro metadata, piercing battle damage, and battle-damage ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${uruquizasCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 53714009, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode], extra: [uruquizasCode] }, 1: { main: [defenseTargetCode] } });
    startDuel(session);

    const uruquizas = requireCard(session, uruquizasCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    moveMonster(session, tuner, 0, "faceUpAttack", 0);
    moveMonster(session, nonTuner, 0, "faceUpAttack", 1);
    moveMonster(session, defenseTarget, 1, "faceUpDefense", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(uruquizasCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(uruquizas.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === uruquizas.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, sourceUid: uruquizas.uid },
      { category: undefined, code: effectPierce, event: "continuous", property: undefined, sourceUid: uruquizas.uid },
      { category: 2097152, code: eventBattleDamage, event: "trigger", property: undefined, sourceUid: uruquizas.uid },
    ]);

    const synchroSummon = getLegalActions(session, 0).find((action): action is Extract<DuelAction, { type: "synchroSummon" }> =>
      action.type === "synchroSummon" && action.uid === uruquizas.uid && sameMembers(action.materialUids, [tuner.uid, nonTuner.uid])
    );
    expect(synchroSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, synchroSummon!);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    expect(restoredSummoned.session.state.cards.find((card) => card.uid === uruquizas.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    restoredSummoned.session.state.phase = "battle";
    restoredSummoned.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredSummoned, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === uruquizas.uid && action.targetUid === defenseTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSummoned, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummoned, attack!);
    passBattleUntilPendingTrigger(restoredSummoned);

    expect(restoredSummoned.session.state.battleDamage).toEqual({ 0: 0, 1: 1100 });
    expect(restoredSummoned.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventPlayer: trigger.eventPlayer,
      eventValue: trigger.eventValue,
    }))).toEqual([
      {
        sourceUid: uruquizas.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "battleDamageDealt",
        eventCode: eventBattleDamage,
        eventCardUid: uruquizas.uid,
        eventPlayer: 1,
        eventValue: 1100,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === uruquizas.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === uruquizas.uid), restoredTrigger.session.state)).toBe(2400);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === uruquizas.uid && [effectPierce, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectPierce, property: undefined, reset: undefined, sourceUid: uruquizas.uid, value: undefined },
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandardDisable }, sourceUid: uruquizas.uid, value: 300 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "attackDeclared", "battleDamageDealt"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: tuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventPlayer: undefined, eventValue: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: nonTuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventPlayer: undefined, eventValue: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: uruquizas.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventPlayer: undefined, eventValue: undefined, previous: "extraDeck", current: "monsterZone", relatedEffectId: undefined },
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: uruquizas.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventPlayer: undefined, eventValue: undefined, previous: "extraDeck", current: "monsterZone", relatedEffectId: undefined },
      { eventName: "battleDamageDealt", eventCode: eventBattleDamage, eventCardUid: uruquizas.uid, eventReason: duelReason.battle, eventReasonPlayer: 0, eventPlayer: 1, eventValue: 1100, previous: "extraDeck", current: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === uruquizas.uid), restoredAfter.session.state)).toBe(2400);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Flamvell Uruquizas");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("return ep~=tp");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: uruquizasCode, name: "Flamvell Uruquizas", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: racePyro, attribute: attributeFire, level: 6, attack: 2100, defense: 400 },
    { code: tunerCode, name: "Flamvell Uruquizas Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: racePyro, attribute: attributeFire, level: 3, attack: 1000, defense: 1000 },
    { code: nonTunerCode, name: "Flamvell Uruquizas Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 3, attack: 1200, defense: 1000 },
    { code: defenseTargetCode, name: "Flamvell Uruquizas Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: CardPosition, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = position;
  moved.sequence = sequence;
  return moved;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passBattleUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
