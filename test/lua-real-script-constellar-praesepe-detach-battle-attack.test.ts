import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const praesepeCode = "2091298";
const materialCode = "20912980";
const constellarAttackerCode = "20912981";
const defenderCode = "20912982";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPraesepeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${praesepeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setConstellar = 0x53;
const effectFlagCannotDisable = 0x400;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 0x41fe1200;

describe.skipIf(!hasUpstreamScripts || !hasPraesepeScript)("Lua real script Constellar Praesepe detach battle attack", () => {
  it("restores Damage Step detach cost into battle-related Constellar ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${praesepeCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 2091298, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, constellarAttackerCode], extra: [praesepeCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const praesepe = requireCard(session, praesepeCode);
    const material = requireCard(session, materialCode);
    const attacker = requireCard(session, constellarAttackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, praesepe, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    praesepe.overlayUids.push(material.uid);
    moveFaceUpAttack(session, attacker, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.turnPlayer = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(praesepeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(praesepe.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialSetcode: setConstellar });

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep" });
    passBattleAction(session, 1, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.uid === praesepe.uid)?.data).toMatchObject({
      xyzMaterialCount: 2,
      xyzMaterialSetcode: setConstellar,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === praesepe.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: praesepe.uid },
      { category: 2097152, code: 1002, countLimit: 1, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: praesepe.uid },
    ]);
    const boost = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === praesepe.uid,
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, boost!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: praesepe.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === praesepe.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === attacker.uid), restored.session.state)).toBe(2800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === defender.uid), restored.session.state)).toBe(2400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: attacker.uid, value: 1000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: praesepe.uid, eventReasonEffectId: 2 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === attacker.uid), restoredAfter.session.state)).toBe(2800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Constellar Praesepe");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_CONSTELLAR),4,2)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(s.condition)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("local phase=Duel.GetCurrentPhase()");
  expect(script).toContain("if phase~=PHASE_DAMAGE or Duel.IsDamageCalculated() then return false end");
  expect(script).toContain("local tc=Duel.GetAttacker()");
  expect(script).toContain("if tc:IsControler(1-tp) then tc=Duel.GetAttackTarget() end");
  expect(script).toContain("tc:IsFaceup() and tc:IsSetCard(SET_CONSTELLAR) and tc:IsRelateToBattle()");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: praesepeCode, name: "Constellar Praesepe", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceMachine, attribute: attributeLight, level: 4, attack: 2400, defense: 800, setcodes: [setConstellar] },
    { code: materialCode, name: "Praesepe Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1000, defense: 1000, setcodes: [setConstellar] },
    { code: constellarAttackerCode, name: "Praesepe Constellar Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1800, defense: 1000, setcodes: [setConstellar] },
    { code: defenderCode, name: "Praesepe Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
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

function passBattleAction(session: DuelSession, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLegalActions(session, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
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
