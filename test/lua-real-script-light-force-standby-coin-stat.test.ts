import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const lightForceCode = "30913809";
const fairyCode = "309138090";
const warriorCode = "309138091";
const hasLightForceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightForceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasLightForceScript)("Lua real script Light Force Standby coin stat", () => {
  it("restores its Standby Phase TossCoin trigger and keeps Fairy stat effects active on heads", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightForceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightForceCode, fairyCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);

    const lightForce = requireCard(session, lightForceCode);
    const fairy = requireCard(session, fairyCode);
    const warrior = requireCard(session, warriorCode);
    moveFaceUpSpellTrap(session, lightForce, 0, 0);
    moveFaceUpAttack(session, fairy, 0, 0);
    moveFaceUpAttack(session, warrior, 0, 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lightForceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    expect(restoredDraw.session.state.effects.filter((effect) => effect.sourceUid === lightForce.uid).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 1002, countLimit: undefined, event: "ignition", range: ["hand", "spellTrapZone"], targetRange: undefined, value: undefined },
      { code: 4098, countLimit: 1, event: "trigger", range: ["spellTrapZone"], targetRange: undefined, value: undefined },
      { code: effectUpdateAttack, countLimit: undefined, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 0], value: 300 },
      { code: effectUpdateDefense, countLimit: undefined, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 0], value: 300 },
      { code: undefined, countLimit: 1, event: "ignition", range: ["spellTrapZone"], targetRange: undefined, value: undefined },
    ]);
    expect(currentAttack(fairy, restoredDraw.session.state)).toBe(1300);
    expect(currentDefense(fairy, restoredDraw.session.state)).toBe(1300);
    expect(currentAttack(warrior, restoredDraw.session.state)).toBe(1000);
    expect(currentDefense(warrior, restoredDraw.session.state)).toBe(1000);

    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestored(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4098",
        eventCode: 4098,
        eventName: "phaseStandby",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: lightForce.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === lightForce.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(currentAttack(findCard(restoredTrigger.session, fairy.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentDefense(findCard(restoredTrigger.session, fairy.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(findCard(restoredTrigger.session, warrior.uid), restoredTrigger.session.state)).toBe(1000);
    expect(currentDefense(findCard(restoredTrigger.session, warrior.uid), restoredTrigger.session.state)).toBe(1000);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "coinTossed"].includes(event.eventName))).toEqual([
      { eventName: "phaseStandby", eventCode: 4098 },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lightForce.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Light Force");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.TossCoin(tp,1)==COIN_TAILS");
  expect(script).toContain("c:HasFlagEffect(id)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("aux.TargetBoolFunction(Card.IsRace,RACE_FAIRY)");
  expect(script).toContain("e4:SetCost(s.thcost)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: lightForceCode, name: "Light Force", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: fairyCode, name: "Light Force Fairy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 4, attack: 1000, defense: 1000 },
    { code: warriorCode, name: "Light Force Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
