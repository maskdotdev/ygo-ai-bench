import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const machineKingCode = "70406920";
const releaseMachineCode = "704069201";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMachineKingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${machineKingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceMachine = 0x200;
const attributeEarth = 0x1;
const effectCannotSummon = 20;
const effectCannotSpecialSummon = 22;
const effectUpdateAttack = 100;
const effectFlagPlayerTargetOath = 0x80800;
const resetPhaseEnd = 1073742336;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasMachineKingScript)("Lua real script Machine King 3000 B.C. trap summon release stat", () => {
  it("restores trap-monster Special Summon oath locks and release-cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectMachineKingScriptShape(workspace.readScript(`official/c${machineKingCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredTrapSetField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const machineKing = requireCard(restoredOpen.session, machineKingCode);
    const releaseMachine = requireCard(restoredOpen.session, releaseMachineCode);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === machineKing.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    const summonedMachineKing = restoredOpen.session.state.cards.find((card) => card.uid === machineKing.uid);
    expect(summonedMachineKing).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: machineKing.uid,
      reasonEffectId: 1,
      data: { typeFlags: typeMonster | typeEffect | typeTrap, attack: 1000, defense: 1000 },
    });
    expect(cardTypeFlags(summonedMachineKing, restoredOpen.session.state)).toBe(typeMonster | typeEffect | typeTrap);
    expect(currentAttack(summonedMachineKing, restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === machineKing.uid && [effectCannotSpecialSummon, effectCannotSummon].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotSpecialSummon, property: effectFlagPlayerTargetOath, reset: { flags: resetPhaseEnd }, sourceUid: machineKing.uid, targetRange: [1, 0], value: undefined },
      { code: effectCannotSummon, property: effectFlagPlayerTargetOath, reset: { flags: resetPhaseEnd }, sourceUid: machineKing.uid, targetRange: [1, 0], value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: machineKing.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: machineKing.uid, eventReasonEffectId: 1, previous: "spellTrapZone", current: "monsterZone" },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === machineKing.uid && action.effectId === "lua-5",
    );
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, attackBoost!);
    resolveRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === releaseMachine.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: machineKing.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === machineKing.uid), restoredIgnition.session.state)).toBe(2200);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === machineKing.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, registryKey: `lua:${machineKingCode}:lua-6-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: machineKing.uid, value: 1200 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: machineKing.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: machineKing.uid, eventReasonEffectId: 1, previous: "spellTrapZone", current: "monsterZone" },
      { eventName: "released", eventCode: 1017, eventCardUid: releaseMachine.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: machineKing.uid, eventReasonEffectId: 5, previous: "monsterZone", current: "graveyard" },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredTrapSetField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70406920, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [machineKingCode, releaseMachineCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceDownTrap(session, requireCard(session, machineKingCode));
  moveFaceUpAttack(session, requireCard(session, releaseMachineCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(machineKingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectMachineKingScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Machine King - 3000 B.C.");
  expect(script).toContain("Duel.GetActivityCount(tp,ACTIVITY_SUMMON)==0");
  expect(script).toContain("Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SUMMON)");
  expect(script).toContain("e1:SetTargetRange(1,0)");
  expect(script).toContain("e2:SetTargetRange(1,0)");
  expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,0,TYPE_MONSTER|TYPE_EFFECT,1000,1000,4,RACE_MACHINE,ATTRIBUTE_EARTH)");
  expect(script).toContain("c:AddMonsterAttribute(TYPE_EFFECT+TYPE_TRAP)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsRace,1,false,nil,e:GetHandler(),RACE_MACHINE)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsRace,1,1,false,nil,e:GetHandler(),RACE_MACHINE)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetAttack())");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: machineKingCode, name: "Machine King - 3000 B.C.", kind: "trap", typeFlags: typeTrap, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: releaseMachineCode, name: "Machine King Release Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  return moved;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
