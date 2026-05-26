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
const sabreCode = "88753594";
const targetFusionCode = "887535940";
const graveBeastWarriorCode = "887535941";
const banishedBeastWarriorCode = "887535942";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSabreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sabreCode}.lua`));
const setLunalight = 0xdf;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectCannotBeEffectTarget = 71;
const effectSpSummonCondition = 30;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasSabreScript)("Lua real script Lunalight Sabre Dancer fusion grave stat", () => {
  it("restores Beast-Warrior count ATK, opponent targeting protection, and grave SelfBanish Fusion boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${sabreCode}.lua`));
    const reader = createCardReader(cards());

    const restoredField = createRestoredSabreField({ reader, workspace, scenario: "field" });
    expectCleanRestore(restoredField);
    expectRestoredLegalActions(restoredField, 0);
    const fieldSabre = requireCard(restoredField.session, sabreCode);
    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === fieldSabre.uid), restoredField.session.state)).toBe(3400);
    expect(restoredField.session.state.effects.filter((effect) => effect.sourceUid === fieldSabre.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaValueDescriptor: effect.luaValueDescriptor,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", luaValueDescriptor: undefined, property: 263168, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { code: effectSpSummonCondition, event: "continuous", luaValueDescriptor: "special-summon-condition:type:1124073472", property: 263168, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { code: effectUpdateAttack, event: "continuous", luaValueDescriptor: "stat:matching-race-count:controller:48:48:32768:x200", property: 131072, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { code: effectCannotBeEffectTarget, event: "continuous", luaValueDescriptor: "cannot-be-effect-target:opponent", property: 131072, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { code: undefined, event: "ignition", luaValueDescriptor: undefined, property: 16, range: ["graveyard"], sourceUid: fieldSabre.uid, value: undefined },
    ]);

    const restoredGrave = createRestoredSabreField({ reader, workspace, scenario: "grave" });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveSabre = requireCard(restoredGrave.session, sabreCode);
    const targetFusion = requireCard(restoredGrave.session, targetFusionCode);
    const action = getLuaRestoreLegalActions(restoredGrave, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === graveSabre.uid && candidate.effectId === "lua-5",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, action!);
    resolveRestoredChain(restoredGrave);

    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveSabre.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveSabre.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredGrave.session.state.cards.find((card) => card.uid === targetFusion.uid), restoredGrave.session.state)).toBe(5100);
    expect(restoredGrave.session.state.effects.filter((effect) => effect.sourceUid === targetFusion.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: targetFusion.uid, value: 3000 },
    ]);
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveSabre.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveSabre.uid, eventReasonEffectId: 5 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: targetFusion.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === targetFusion.uid), restoredPersistent.session.state)).toBe(5100);
  });
});

function createRestoredSabreField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "field" | "grave";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "field" ? 88753594 : 88753595, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [graveBeastWarriorCode, banishedBeastWarriorCode], extra: [sabreCode, targetFusionCode] }, 1: { main: [] } });
  startDuel(session);
  const sabre = requireCard(session, sabreCode);
  const graveBeastWarrior = requireCard(session, graveBeastWarriorCode);
  const banishedBeastWarrior = requireCard(session, banishedBeastWarriorCode);
  moveDuelCard(session.state, graveBeastWarrior.uid, "graveyard", 0);
  moveDuelCard(session.state, banishedBeastWarrior.uid, "banished", 0);
  if (scenario === "field") {
    moveFaceUpAttack(session, sabre, 0, 0);
  } else {
    moveDuelCard(session.state, sabre.uid, "graveyard", 0);
    sabre.turnId = Math.max(0, session.state.turn - 1);
    moveFaceUpAttack(session, requireCard(session, targetFusionCode), 0, 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sabreCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Lunalight Sabre Dancer");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_LUNALIGHT),3)");
  expect(script).toContain("e1:SetValue(aux.fuslimit)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return Duel.GetMatchingGroupCount(s.atkfilter,c:GetControler(),LOCATION_GRAVE|LOCATION_REMOVED,LOCATION_GRAVE|LOCATION_REMOVED,nil)*200");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e3:SetValue(aux.tgoval)");
  expect(script).toContain("e4:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(3000)");
}

function cards(): DuelCardData[] {
  return [
    { code: sabreCode, name: "Lunalight Sabre Dancer", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeastWarrior, attribute: attributeDark, level: 9, attack: 3000, defense: 2600, setcodes: [setLunalight] },
    { code: targetFusionCode, name: "Lunalight Sabre Dancer Fusion Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeastWarrior, attribute: attributeDark, level: 8, attack: 2100, defense: 1800, setcodes: [setLunalight] },
    { code: graveBeastWarriorCode, name: "Lunalight Sabre Dancer Grave Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setLunalight] },
    { code: banishedBeastWarriorCode, name: "Lunalight Sabre Dancer Banished Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
