import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gracefulDiceCode = "74137509";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Graceful Dice damage-step stat update", () => {
  it("restores a Damage Step dice roll into group ATK/DEF updates and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "741375090";
    const allyCode = "741375091";
    const defenderCode = "741375092";
    const script = workspace.readScript(`c${gracefulDiceCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(function() return not (Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()) end)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("local val=Duel.TossDice(tp,1)*100");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gracefulDiceCode),
      { code: attackerCode, name: "Graceful Dice Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: allyCode, name: "Graceful Dice Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 1600 },
      { code: defenderCode, name: "Graceful Dice Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1300 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7413, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gracefulDiceCode, attackerCode, allyCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const gracefulDice = requireCard(session, gracefulDiceCode);
    const attacker = requireCard(session, attackerCode);
    const ally = requireCard(session, allyCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, gracefulDice.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ally.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gracefulDiceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const gracefulAction = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === gracefulDice.uid);
    expect(gracefulAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, gracefulAction!);
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(restoredActivation.session.state.lastDiceResults).toHaveLength(1);
    expect(restoredActivation.session.state.randomCounter).toBe(1);
    const [die] = restoredActivation.session.state.lastDiceResults;
    expect(die).toBe(4);
    const update = die! * 100;
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "diceTossed")).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonCardUid: gracefulDice.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
      },
    ]);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(1500 + update);
    expect(currentDefense(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(1200 + update);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === ally.uid), restoredActivation.session.state)).toBe(800 + update);
    expect(currentDefense(restoredActivation.session.state.cards.find((card) => card.uid === ally.uid), restoredActivation.session.state)).toBe(1600 + update);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === defender.uid), restoredActivation.session.state)).toBe(1700);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === attacker.uid && [100, 104].includes(effect.code ?? -1))).toHaveLength(2);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === ally.uid && [100, 104].includes(effect.code ?? -1))).toHaveLength(2);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 1);
    expect(currentAttack(restoredStats.session.state.cards.find((card) => card.uid === attacker.uid), restoredStats.session.state)).toBe(1500 + update);
    passRestoredBattleResponses(restoredStats);
    expect(restoredStats.session.state.battleDamage).toEqual({ 0: 0, 1: Math.max(0, 1500 + update - 1700) });
    expect(restoredStats.session.state.players[1].lifePoints).toBe(8000 - Math.max(0, 1500 + update - 1700));
    expect(restoredStats.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passBattleAction(session: DuelSession, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLegalActions(session, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
