import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spiderCode = "79625003";
const materialCode = "796250030";
const removeTargetCode = "796250031";
const attackDropTargetCode = "796250032";
const destroyedDecoyCode = "796250033";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSeaSerpent = 0x200;
const attributeWater = 0x2;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const standbyPhaseCode = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasSpiderScript)("Lua real script Number S37 Spider Shark remove return stat summon", () => {
  it("restores detach temporary banish return, opponent ATK loss, and destroyed End Phase self-summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spiderCode}.lua`));
    const reader = createCardReader(cards());

    const restoredIgnition = createRestoredSpiderField({ reader, workspace });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const spider = requireCard(restoredIgnition.session, spiderCode);
    const material = requireCard(restoredIgnition.session, materialCode);
    const removeTarget = requireCard(restoredIgnition.session, removeTargetCode);
    const attackDropTarget = requireCard(restoredIgnition.session, attackDropTargetCode);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === spider.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: spider.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === spider.uid)?.overlayUids).toEqual([]);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === removeTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: spider.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === attackDropTarget.uid), restoredIgnition.session.state)).toBe(800);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === spider.uid && effect.code === standbyPhaseCode).map((effect) => ({
      code: effect.code,
      labelObjectUid: effect.labelObjectUid,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: standbyPhaseCode, labelObjectUid: removeTarget.uid, reset: { flags: 1073741826, count: 1 }, sourceUid: spider.uid },
    ]);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === attackDropTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: attackDropTarget.uid, value: -1000 },
    ]);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turnPlayer = 1;
    restoredReturn.session.state.phase = "draw";
    restoredReturn.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredReturn, 1);
    const standby = getLuaRestoreLegalActions(restoredReturn, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, standby!);
    expect(restoredReturn.session.state.cards.find((card) => card.uid === removeTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: spider.uid,
      reasonEffectId: 4,
    });

    const restoredDestroyed = createRestoredSpiderField({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    const destroyedSpider = requireCard(restoredDestroyed.session, spiderCode);
    destroyDuelCard(restoredDestroyed.session.state, destroyedSpider.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedSpider.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    restoredTrigger.session.state.phase = "main2";
    restoredTrigger.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredTrigger, 0);
    const end = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, end!);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-4608", eventCode: 4608, eventName: "phaseEnd", player: 0, sourceUid: destroyedSpider.uid, triggerBucket: "turnOptional" },
    ]);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedSpider.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === destroyedSpider.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedSpider.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["detachedMaterial", "banished", "phaseStandby", "destroyed", "phaseEnd", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedSpider.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "phaseEnd", eventCode: 4608, eventCardUid: undefined, eventPlayer: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: destroyedSpider.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedSpider.uid, eventReasonEffectId: 3, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSpiderField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79625003, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [spiderCode] }, 1: { main: [removeTargetCode, attackDropTargetCode, destroyedDecoyCode] } });
  startDuel(session);
  const spider = moveFaceUpAttack(session, requireCard(session, spiderCode), 0, 2);
  spider.summonType = "xyz";
  markProcedureComplete(spider);
  spider.turnId = session.state.turn;
  const material = moveDuelCard(session.state, requireCard(session, materialCode).uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  material.sequence = 0;
  spider.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, removeTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, attackDropTargetCode), 1, 1);
  moveFaceUpAttack(session, requireCard(session, destroyedDecoyCode), 1, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spiderCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number S37: Spider Shark");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),5,3,s.ovfilter,aux.Stringid(id,0))");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1))");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToRemove,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("aux.RemoveUntil(tc,nil,REASON_EFFECT,PHASE_STANDBY,id,e,tp,aux.DefaultFieldReturnOp,function() return Duel.IsTurnPlayer(1-tp) end)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("c:GetTurnID()==Duel.GetTurnCount() and c:IsXyzSummoned() and c:IsPreviousLocation(LOCATION_MZONE) and c:IsReason(REASON_DESTROY)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: spiderCode, name: "Number S37: Spider Shark", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 2600, defense: 2100, xyzMaterialCount: 3 },
    { code: materialCode, name: "Spider Shark Xyz Material", kind: "monster", typeFlags: typeMonster, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 1200, defense: 1200 },
    { code: removeTargetCode, name: "Spider Shark Temporary Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
    { code: attackDropTargetCode, name: "Spider Shark ATK Drop Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: destroyedDecoyCode, name: "Spider Shark Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
