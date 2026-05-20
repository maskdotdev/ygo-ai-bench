import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const stoneStatueCode = "31812496";
const hasStoneStatueScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${stoneStatueCode}.lua`));
const attackerCode = "31812497";
const ordinaryWallCode = "31812498";
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectChangeBattleDamage = 208;

describe.skipIf(!hasUpstreamScripts || !hasStoneStatueScript)("Lua real script Stone Statue double battle damage", () => {
  it("restores defender-side aux.ChangeBattleDamage DOUBLE_DAMAGE only while it is the attack target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${stoneStatueCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("e1:SetCondition(s.dcon)");
    expect(script).toContain("e1:SetValue(aux.ChangeBattleDamage(1,DOUBLE_DAMAGE))");
    expect(script).toContain("return Duel.GetAttackTarget()==e:GetHandler()");

    const protectedDuel = setupBattleDuel(stoneStatueCode, "Stone Statue of the Aztecs", typeMonster | typeEffect);
    const attacker = requireCard(protectedDuel.session, attackerCode);
    const stoneStatue = requireCard(protectedDuel.session, stoneStatueCode);
    const host = createLuaScriptHost(protectedDuel.session, workspace);
    expect(host.loadCardScript(Number(stoneStatueCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(protectedDuel.session.state.effects.filter((effect) => effect.sourceUid === stoneStatue.uid && effect.code === effectChangeBattleDamage).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        code: effectChangeBattleDamage,
        controller: 1,
        event: "continuous",
        sourceUid: stoneStatue.uid,
      },
    ]);

    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(protectedDuel.session), workspace, protectedDuel.reader);
    expectCleanRestore(restoredProtected);
    expectRestoredLegalActions(restoredProtected, 0);
    declareRestoredAttack(restoredProtected, attacker, stoneStatue);
    passBattleUntilComplete(restoredProtected);
    expect(restoredProtected.session.state.battleDamage).toEqual({ 0: 1600, 1: 0 });
    expect(restoredProtected.session.state.players[0].lifePoints).toBe(6400);
    expect(restoredProtected.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredProtected.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: stoneStatue.uid,
        eventPlayer: 0,
        eventValue: 1600,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
        eventReasonCardUid: stoneStatue.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const ordinaryDuel = setupBattleDuel(ordinaryWallCode, "Ordinary Defense Wall", typeMonster);
    const ordinaryAttacker = requireCard(ordinaryDuel.session, attackerCode);
    const ordinaryWall = requireCard(ordinaryDuel.session, ordinaryWallCode);
    const restoredOrdinary = restoreDuelWithLuaScripts(serializeDuel(ordinaryDuel.session), workspace, ordinaryDuel.reader);
    expectCleanRestore(restoredOrdinary);
    expectRestoredLegalActions(restoredOrdinary, 0);
    declareRestoredAttack(restoredOrdinary, ordinaryAttacker, ordinaryWall);
    passBattleUntilComplete(restoredOrdinary);
    expect(restoredOrdinary.session.state.battleDamage).toEqual({ 0: 800, 1: 0 });
    expect(restoredOrdinary.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredOrdinary.session.state.players[1].lifePoints).toBe(8000);
  });
});

function setupBattleDuel(defenderCode: string, defenderName: string, defenderTypeFlags: number): { session: DuelSession; reader: ReturnType<typeof createCardReader> } {
  const cards: DuelCardData[] = [
    { code: attackerCode, name: "Stone Statue Fixture Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
    { code: defenderCode, name: defenderName, kind: "monster", typeFlags: defenderTypeFlags, level: 4, attack: 300, defense: 2200 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: Number(defenderCode), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const attacker = requireCard(session, attackerCode);
  const defender = requireCard(session, defenderCode);
  moveDuelCard(session.state, attacker.uid, "monsterZone", 0);
  attacker.faceUp = true;
  attacker.position = "faceUpAttack";
  moveDuelCard(session.state, defender.uid, "monsterZone", 1);
  defender.faceUp = true;
  defender.position = "faceUpDefense";
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return { session, reader };
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function declareRestoredAttack(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attacker: DuelCardInstance, target: DuelCardInstance): void {
  const attack = getLuaRestoreLegalActions(restored, 0).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid,
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  expect(restored.session.state.battleWindow?.kind).toBe("attackNegationResponse");
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
