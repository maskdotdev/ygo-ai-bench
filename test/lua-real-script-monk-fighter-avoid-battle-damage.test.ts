import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const monkFighterCode = "3810071";
const hasMonkFighterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${monkFighterCode}.lua`));
const ordinaryAttackerCode = "3810072";
const wallCode = "3810073";
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectAvoidBattleDamage = 201;

describe.skipIf(!hasUpstreamScripts || !hasMonkFighterScript)("Lua real script Monk Fighter avoid battle damage", () => {
  it("restores static EFFECT_AVOID_BATTLE_DAMAGE while ordinary attackers still take battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${monkFighterCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE)");
    expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e1:SetValue(1)");

    const protectedDuel = setupBattleDuel(monkFighterCode, "Monk Fighter", typeMonster | typeEffect);
    const protectedAttacker = requireCard(protectedDuel.session, monkFighterCode);
    const protectedWall = requireCard(protectedDuel.session, wallCode);
    const host = createLuaScriptHost(protectedDuel.session, workspace);
    expect(host.loadCardScript(Number(monkFighterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(protectedDuel.session.state.effects.filter((effect) => effect.code === effectAvoidBattleDamage).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectAvoidBattleDamage,
        controller: 0,
        event: "continuous",
        sourceUid: protectedAttacker.uid,
        value: 1,
      },
    ]);

    const protectedBattleSession = declareRestoredAttack(protectedDuel.session, protectedDuel.reader, workspace, protectedAttacker, protectedWall);
    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(protectedBattleSession), workspace, protectedDuel.reader);
    expectCleanRestore(restoredProtected);
    expectRestoredLegalActions(restoredProtected, 0);
    passBattleResponses(restoredProtected.session);
    expect(restoredProtected.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredProtected.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredProtected.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredProtected.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);

    const unprotectedDuel = setupBattleDuel(ordinaryAttackerCode, "Ordinary Battle Damage Attacker", typeMonster);
    const ordinaryAttacker = requireCard(unprotectedDuel.session, ordinaryAttackerCode);
    const unprotectedWall = requireCard(unprotectedDuel.session, wallCode);
    const unprotectedBattleSession = declareRestoredAttack(unprotectedDuel.session, unprotectedDuel.reader, workspace, ordinaryAttacker, unprotectedWall);
    const restoredUnprotected = restoreDuelWithLuaScripts(serializeDuel(unprotectedBattleSession), workspace, unprotectedDuel.reader);
    expectCleanRestore(restoredUnprotected);
    expectRestoredLegalActions(restoredUnprotected, 0);
    passBattleResponses(restoredUnprotected.session);
    expect(restoredUnprotected.session.state.battleDamage).toEqual({ 0: 800, 1: 0 });
    expect(restoredUnprotected.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredUnprotected.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredUnprotected.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: unprotectedWall.uid,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: 32,
        eventReasonPlayer: 1,
        eventReasonCardUid: unprotectedWall.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

function setupBattleDuel(attackerCode: string, attackerName: string, attackerTypeFlags: number): { session: DuelSession; reader: ReturnType<typeof createCardReader> } {
  const cards: DuelCardData[] = [
    { code: attackerCode, name: attackerName, kind: "monster", typeFlags: attackerTypeFlags, level: 4, attack: 1400, defense: 1000 },
    { code: wallCode, name: "Monk Fighter Defense Wall", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 2200 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: Number(attackerCode), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [wallCode] } });
  startDuel(session);
  const attacker = requireCard(session, attackerCode);
  const wall = requireCard(session, wallCode);
  moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
  attacker.faceUp = true;
  moveDuelCard(session.state, wall.uid, "monsterZone", 1).position = "faceUpDefense";
  wall.faceUp = true;
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return { session, reader };
}

function declareRestoredAttack(
  session: DuelSession,
  reader: ReturnType<typeof createCardReader>,
  source: ReturnType<typeof createUpstreamNodeWorkspace>,
  attacker: DuelCardInstance,
  target: DuelCardInstance,
): DuelSession {
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  const attack = getLuaRestoreLegalActions(restored, 0).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid,
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyAndAssert(restored.session, attack!);
  expect(restored.session.state.battleWindow?.kind).toBe("attackNegationResponse");
  return restored.session;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
