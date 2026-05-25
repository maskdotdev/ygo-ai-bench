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
const rocketCode = "30860696";
const defenderCode = "308606960";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRocketScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rocketCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRocketScript)("Lua real script Rocket Warrior battled protect attack drop", () => {
  it("restores own-turn battle protection and EVENT_BATTLED target ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rocketCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const rocket = requireCard(restored.session, rocketCode);
    const defender = requireCard(restored.session, defenderCode);

    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rocket.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 42, event: "continuous", sourceUid: rocket.uid, value: 1 },
      { code: 201, event: "continuous", sourceUid: rocket.uid, value: 1 },
      { code: 1138, event: "trigger", sourceUid: rocket.uid, value: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === rocket.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passRestoredBattleUntil(restored, () => restored.session.state.pendingTriggers.some((trigger) => trigger.effectId === "lua-3-1138"));

    expect(restored.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0]?.lifePoints).toBe(8000);
    expect(findCard(restored.session, rocket.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(restored.session, defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === rocket.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredAfterTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfterTrigger);
    expectRestoredLegalActions(restoredAfterTrigger, restoredAfterTrigger.session.state.waitingFor ?? restoredAfterTrigger.session.state.turnPlayer);
    expect(currentAttack(findCard(restoredAfterTrigger.session, defender.uid), restoredAfterTrigger.session.state)).toBe(1700);
    expect(restoredAfterTrigger.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: defender.uid, value: -500 },
    ]);
    expect(restoredAfterTrigger.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: rocket.uid, eventCode: 1138, eventName: "afterDamageCalculation", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0, eventUids: [rocket.uid, defender.uid], eventValue: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const rocket = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === rocketCode);
  expect(rocket).toBeDefined();
  return [
    rocket!,
    { code: defenderCode, name: "Rocket Warrior Fixture Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 30860696, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rocketCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, rocketCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rocketCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Rocket Warrior");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("return Duel.GetTurnPlayer()==e:GetHandlerPlayer()");
  expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
  expect(script).toContain("return e:GetHandler()==Duel.GetAttacker() and Duel.GetAttackTarget()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, pass!);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
