import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const castleCode = "62121";
const oldZombieCode = "621210";
const newZombieCode = "621211";
const warriorCode = "621212";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCastleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${castleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const eventPhaseStandby = 4098;

describe.skipIf(!hasUpstreamScripts || !hasCastleScript)("Lua real script Castle of Dark Illusions flip standby stat", () => {
  it("restores flip-created Zombie field stat effects and Standby Phase stat step-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${castleCode}.lua`);
    expect(script).toContain("--Castle of Dark Illusions");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("local mg,fid=g:GetMaxGroup(Card.GetFieldID)");
    expect(script).toContain("return c:GetFieldID()<=e:GetLabel() and c:IsRace(RACE_ZOMBIE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("return Duel.IsTurnPlayer(tp)");
    expect(script).toContain("e:GetLabelObject():SetValue(ct*200)");
    expect(script).toContain("e:GetLabelObject():GetLabelObject():SetValue(ct*200)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 62121, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [castleCode, oldZombieCode, newZombieCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);

    const castle = requireCard(session, castleCode);
    const oldZombie = requireCard(session, oldZombieCode);
    const newZombie = requireCard(session, newZombieCode);
    const warrior = requireCard(session, warriorCode);
    moveFaceDownDefense(session, castle, 0, 0);
    moveFaceUpAttack(session, oldZombie, 0, 1);
    moveFaceUpAttack(session, warrior, 0, 2);
    moveDuelCard(session.state, newZombie.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(castleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === castle.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === castle.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, trigger!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(find(restoredOpen.session, castle.uid), restoredOpen.session.state)).toBe(1120);
    expect(currentDefense(find(restoredOpen.session, castle.uid), restoredOpen.session.state)).toBe(2130);
    expect(currentAttack(find(restoredOpen.session, oldZombie.uid), restoredOpen.session.state)).toBe(1200);
    expect(currentDefense(find(restoredOpen.session, oldZombie.uid), restoredOpen.session.state)).toBe(1200);
    expect(currentAttack(find(restoredOpen.session, warrior.uid), restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === castle.uid && [effectUpdateAttack, effectUpdateDefense, eventPhaseStandby].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      labelObjectId: effect.labelObjectId,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", label: 7, labelObjectId: undefined, range: ["monsterZone"], reset: { flags: 33492992 }, targetRange: [4, 4], triggerEvent: undefined, value: 200 },
      { code: effectUpdateDefense, event: "continuous", label: 7, labelObjectId: 2, range: ["monsterZone"], reset: { flags: 33492992 }, targetRange: [4, 4], triggerEvent: undefined, value: 200 },
      { code: eventPhaseStandby, event: "trigger", label: 2, labelObjectId: 3, range: ["monsterZone"], reset: { flags: 1375670274, count: 4 }, targetRange: undefined, triggerEvent: "phaseStandby", value: undefined },
    ]);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 0);
    moveFaceUpAttack(restoredStats.session, find(restoredStats.session, newZombie.uid), 0, 3);
    expect(currentAttack(find(restoredStats.session, newZombie.uid), restoredStats.session.state)).toBe(1200);
    restoredStats.session.state.phase = "draw";
    restoredStats.session.state.turnPlayer = 0;
    restoredStats.session.state.waitingFor = 0;
    const standby = getLuaRestoreLegalActions(restoredStats, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredStats, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStats, standby!);
    expect(restoredStats.session.state.pendingTriggers.map((pending) => ({
      effectId: pending.effectId,
      eventCode: pending.eventCode,
      eventName: pending.eventName,
      player: pending.player,
      sourceUid: pending.sourceUid,
      triggerBucket: pending.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-4098", eventCode: eventPhaseStandby, eventName: "phaseStandby", player: 0, sourceUid: castle.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredStandby = restoreDuelWithLuaScripts(serializeDuel(restoredStats.session), workspace, reader);
    expectCleanRestore(restoredStandby);
    expectRestoredLegalActions(restoredStandby, 0);
    const standbyTrigger = getLuaRestoreLegalActions(restoredStandby, 0).find((action) => action.type === "activateTrigger" && action.uid === castle.uid);
    expect(standbyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStandby, standbyTrigger!);
    resolveRestoredChain(restoredStandby);
    expect(currentAttack(find(restoredStandby.session, castle.uid), restoredStandby.session.state)).toBe(1320);
    expect(currentDefense(find(restoredStandby.session, castle.uid), restoredStandby.session.state)).toBe(2330);
    expect(currentAttack(find(restoredStandby.session, oldZombie.uid), restoredStandby.session.state)).toBe(1400);
    expect(currentDefense(find(restoredStandby.session, oldZombie.uid), restoredStandby.session.state)).toBe(1400);
    expect(currentAttack(find(restoredStandby.session, newZombie.uid), restoredStandby.session.state)).toBe(1400);
    expect(currentDefense(find(restoredStandby.session, newZombie.uid), restoredStandby.session.state)).toBe(1400);
    expect(restoredStandby.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: castleCode, name: "Castle of Dark Illusions", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 920, defense: 1930 },
    { code: oldZombieCode, name: "Castle Old Zombie", kind: "monster", typeFlags: typeMonster, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: newZombieCode, name: "Castle New Zombie", kind: "monster", typeFlags: typeMonster, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: warriorCode, name: "Castle Warrior", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function find(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
  moved.sequence = sequence;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
