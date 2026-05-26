import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const assaultCode = "14553285";
const arcaniteCode = "31924889";
const opponentMonsterCode = "145532850";
const opponentSpellCode = "145532851";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAssaultScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${assaultCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const counterSpell = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasAssaultScript)("Lua real script Arcanite Assault counter destroy revive", () => {
  it("restores Special Summon counters, counter-cost board wipe, and destroyed Arcanite revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${assaultCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const assault = requireCard(session, assaultCode);
    const arcanite = requireCard(session, arcaniteCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    moveDuelCard(session.state, assault.uid, "hand", 0);
    moveDuelCard(session.state, arcanite.uid, "graveyard", 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    const movedSpell = moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    movedSpell.faceUp = true;
    movedSpell.sequence = 0;
    registerAssault(session, workspace);
    specialSummonDuelCard(session.state, assault.uid, 0, 0, { eventReasonCardUid: assault.uid }, undefined, true, true);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const summonedAssault = requireCard(restoredCounter.session, assaultCode);
    expect(restoredCounter.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1102", eventCardUid: summonedAssault.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: summonedAssault.uid, triggerBucket: "turnMandatory" },
    ]);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summonedAssault.uid && action.effectId === "lua-4-1102"
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, assaultCode), counterSpell)).toBe(2);
    expect(currentAttack(requireCard(restoredCounter.session, assaultCode), restoredCounter.session.state)).toBe(2900);

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), workspace, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonedAssault.uid && action.effectId === "lua-6"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(getDuelCardCounter(requireCard(restoredDestroy.session, assaultCode), counterSpell)).toBe(0);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: summonedAssault.uid,
      reasonEffectId: 6,
    });
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: summonedAssault.uid,
      reasonEffectId: 6,
    });

    const restoredBeforeRevive = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), workspace, reader);
    expectCleanRestore(restoredBeforeRevive);
    const destroyedAssault = requireCard(restoredBeforeRevive.session, assaultCode);
    destroyDuelCard(restoredBeforeRevive.session.state, destroyedAssault.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredBeforeRevive.session), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    expect(restoredRevive.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-7-1029", eventCardUid: destroyedAssault.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: destroyedAssault.uid, triggerBucket: "turnOptional" },
    ]);
    const reviveTrigger = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedAssault.uid && action.effectId === "lua-7-1029"
    );
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, reviveTrigger!);
    expect(restoredRevive.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredRevive);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === arcanite.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedAssault.uid,
      reasonEffectId: 7,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["counterAdded", "counterRemoved", "destroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentMonster.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: summonedAssault.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: summonedAssault.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentMonster.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: summonedAssault.uid, eventReasonEffectId: 6, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedAssault.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: destroyedAssault.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: arcanite.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 7 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: arcanite.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedAssault.uid, eventReasonEffectId: 7, relatedEffectId: undefined },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 14553285, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [assaultCode, arcaniteCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAssault(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(assaultCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcanite Magician/Assault Mode");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("c:AddMustBeSpecialSummoned()");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),2,tp,COUNTER_SPELL)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,2)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("c:GetCounter(COUNTER_SPELL)*1000");
  expect(script).toContain("e3:SetCost(Cost.RemoveCounterFromSelf(COUNTER_SPELL,2))");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: assaultCode, name: "Arcanite Magician/Assault Mode", kind: "monster", typeFlags: typeMonster | typeEffect, level: 9, attack: 900, defense: 2300 },
    { code: arcaniteCode, name: "Arcanite Magician", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 400, defense: 1800 },
    { code: opponentMonsterCode, name: "Arcanite Assault Destroyed Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200 },
    { code: opponentSpellCode, name: "Arcanite Assault Destroyed Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
