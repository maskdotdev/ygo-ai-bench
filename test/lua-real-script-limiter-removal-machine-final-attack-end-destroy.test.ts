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
const limiterCode = "23171610";
const machineOneCode = "231716100";
const machineTwoCode = "231716101";
const warriorCode = "231716102";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceMachine = 0x20;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const eventPhaseEnd = 0x1200;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Limiter Removal Machine final attack End Phase destroy", () => {
  it("restores Machine-wide final ATK doubling and delayed flagged End Phase destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${limiterCode}.lua`));
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === limiterCode),
      { code: machineOneCode, name: "Limiter Machine One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
      { code: machineTwoCode, name: "Limiter Machine Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
      { code: warriorCode, name: "Limiter Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 23171610, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [limiterCode, machineOneCode, machineTwoCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);
    const limiter = requireCard(session, limiterCode);
    const machineOne = requireCard(session, machineOneCode);
    const machineTwo = requireCard(session, machineTwoCode);
    const warrior = requireCard(session, warriorCode);
    moveDuelCard(session.state, limiter.uid, "hand", 0);
    moveFaceUpAttack(session, machineOne, 0, 0);
    moveFaceUpAttack(session, machineTwo, 0, 1);
    moveFaceUpAttack(session, warrior, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(limiterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === limiter.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === limiter.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === machineOne.uid), restoredOpen.session.state)).toBe(2400);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === machineTwo.uid), restoredOpen.session.state)).toBe(3200);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === warrior.uid), restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.effects.filter((effect) => [machineOne.uid, machineTwo.uid].includes(effect.sourceUid) && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: machineOne.uid, value: 2400 },
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: machineTwo.uid, value: 3200 },
    ]);
    const delayedDestroyEffects = restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === limiter.uid && effect.code === eventPhaseEnd);
    expect(delayedDestroyEffects.map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      label: effect.label,
      labelObjectUids: effect.labelObjectUids,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        code: eventPhaseEnd,
        countLimit: 1,
        event: "continuous",
        label: delayedDestroyEffects[0]!.label,
        labelObjectUids: [machineOne.uid, machineTwo.uid],
        reset: { flags: 0x40000200 },
        sourceUid: limiter.uid,
      },
    ]);
    expect(delayedDestroyEffects[0]?.label).toEqual(expect.any(Number));
    expect(restoredOpen.session.state.flagEffects.filter((flag) => flag.code === Number(limiterCode)).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      value: flag.value,
    }))).toEqual([
      { code: Number(limiterCode), ownerId: machineOne.uid, ownerType: "card", value: delayedDestroyEffects[0]!.label },
      { code: Number(limiterCode), ownerId: machineTwo.uid, ownerType: "card", value: delayedDestroyEffects[0]!.label },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === machineOne.uid), restoredBoost.session.state)).toBe(2400);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === machineTwo.uid), restoredBoost.session.state)).toBe(3200);
    restoredBoost.session.state.phase = "main2";
    restoredBoost.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, endPhase!);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: eventPhaseEnd }]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === machineOne.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: effectDestroyReason });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === machineTwo.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: effectDestroyReason });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const destroyedMachineUids = new Set([machineOne.uid, machineTwo.uid]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid !== undefined && destroyedMachineUids.has(event.eventCardUid))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: machineOne.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: limiter.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: machineTwo.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 2, position: "faceUpAttack", faceUp: true },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: limiter.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Limiter Removal");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_MACHINE),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter2,tp,LOCATION_MZONE,0,nil,e)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1,fid)");
  expect(script).toContain("sg:KeepAlive()");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetLabelObject(sg)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
