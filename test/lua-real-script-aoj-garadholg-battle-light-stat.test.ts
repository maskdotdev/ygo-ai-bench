import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ally of Justice Garadholg battle LIGHT stat", () => {
  it("restores its damage-step ATK boost when battling a LIGHT monster as attacker or defender", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const garadholgCode = "25771826";
    const lightTargetCode = "257718260";
    const darkTargetCode = "257718261";
    const script = workspace.readScript(`official/c${garadholgCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("local d=Duel.GetAttackTarget()");
    expect(script).toContain("d:IsFaceup() and d:IsAttribute(ATTRIBUTE_LIGHT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === garadholgCode),
      { code: lightTargetCode, name: "Garadholg LIGHT Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200, attribute: attributeLight },
      { code: darkTargetCode, name: "Garadholg DARK Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200, attribute: attributeDark },
    ];
    const reader = createCardReader(cards);
    const attacking = createGaradholgBattle({ garadholgCode, targetCode: lightTargetCode, cards, seed: 2577, attackerPlayer: 0 });
    const host = createLuaScriptHost(attacking.session, workspace);
    expect(host.loadCardScript(Number(garadholgCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(attacking.session.state.effects.filter((effect) => effect.sourceUid === attacking.garadholg.uid).map((effect) => ({
      code: effect.code,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        id: "lua-1-100",
        luaConditionDescriptor: `condition:damage-source-relate-battle-target-faceup-attribute:${attributeLight}`,
        range: ["monsterZone"],
        sourceUid: attacking.garadholg.uid,
        value: 200,
      },
    ]);
    expect(currentAttack(attacking.garadholg, attacking.session.state)).toBe(attacking.garadholg.data.attack ?? 0);
    declareAndPassToDamage(attacking.session, 0, attacking.garadholg.uid, attacking.target.uid);
    expect(currentAttack(attacking.garadholg, attacking.session.state)).toBe((attacking.garadholg.data.attack ?? 0) + 200);

    const restoredAttacking = restoreDuelWithLuaScripts(serializeDuel(attacking.session), workspace, reader);
    expectCleanRestore(restoredAttacking);
    expect(restoredAttacking.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(restoredAttacking.session.state.cards.find((card) => card.uid === attacking.garadholg.uid), restoredAttacking.session.state)).toBe((attacking.garadholg.data.attack ?? 0) + 200);
    passRestoredBattleResponses(restoredAttacking);
    expect(restoredAttacking.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
    expect(restoredAttacking.session.state.players[1].lifePoints).toBe(7700);
    expect(restoredAttacking.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacking.garadholg.uid,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacking.garadholg.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const defending = createGaradholgBattle({ garadholgCode, targetCode: lightTargetCode, cards, seed: 2578, attackerPlayer: 1 });
    const defendingHost = createLuaScriptHost(defending.session, workspace);
    expect(defendingHost.loadCardScript(Number(garadholgCode), workspace).ok).toBe(true);
    expect(defendingHost.registerInitialEffects()).toBe(1);
    declareAndPassToDamage(defending.session, 1, defending.target.uid, defending.garadholg.uid);
    expect(currentAttack(defending.garadholg, defending.session.state)).toBe((defending.garadholg.data.attack ?? 0) + 200);
    const restoredDefending = restoreDuelWithLuaScripts(serializeDuel(defending.session), workspace, reader);
    expectCleanRestore(restoredDefending);
    expect(currentAttack(restoredDefending.session.state.cards.find((card) => card.uid === defending.garadholg.uid), restoredDefending.session.state)).toBe((defending.garadholg.data.attack ?? 0) + 200);
    passRestoredBattleResponses(restoredDefending);
    expect(restoredDefending.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
    expect(restoredDefending.session.state.players[1].lifePoints).toBe(7700);
    expect(restoredDefending.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: defending.garadholg.uid,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.battle,
        eventReasonCardUid: defending.garadholg.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const unboosted = createGaradholgBattle({ garadholgCode, targetCode: darkTargetCode, cards, seed: 2579, attackerPlayer: 0 });
    const unboostedHost = createLuaScriptHost(unboosted.session, workspace);
    expect(unboostedHost.loadCardScript(Number(garadholgCode), workspace).ok).toBe(true);
    expect(unboostedHost.registerInitialEffects()).toBe(1);
    declareAndPassToDamage(unboosted.session, 0, unboosted.garadholg.uid, unboosted.target.uid);
    expect(currentAttack(unboosted.garadholg, unboosted.session.state)).toBe(unboosted.garadholg.data.attack ?? 0);
    const restoredUnboosted = restoreDuelWithLuaScripts(serializeDuel(unboosted.session), workspace, reader);
    expectCleanRestore(restoredUnboosted);
    expect(currentAttack(restoredUnboosted.session.state.cards.find((card) => card.uid === unboosted.garadholg.uid), restoredUnboosted.session.state)).toBe(unboosted.garadholg.data.attack ?? 0);
  });
});

function createGaradholgBattle(args: { garadholgCode: string; targetCode: string; cards: DuelCardData[]; seed: number; attackerPlayer: 0 | 1 }) {
  const reader = createCardReader(args.cards);
  const session = createDuel({ seed: args.seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, args.attackerPlayer === 0 ? { 0: { main: [args.garadholgCode] }, 1: { main: [args.targetCode] } } : { 0: { main: [args.garadholgCode] }, 1: { main: [args.targetCode] } });
  startDuel(session);
  const garadholg = session.state.cards.find((card) => card.code === args.garadholgCode)!;
  const target = session.state.cards.find((card) => card.code === args.targetCode)!;
  moveDuelCard(session.state, garadholg.uid, "monsterZone", 0);
  garadholg.position = "faceUpAttack";
  garadholg.faceUp = true;
  moveDuelCard(session.state, target.uid, "monsterZone", 1);
  target.position = "faceUpAttack";
  target.faceUp = true;
  session.state.phase = "battle";
  session.state.turnPlayer = args.attackerPlayer;
  session.state.waitingFor = args.attackerPlayer;
  return { session, garadholg, target };
}

function declareAndPassToDamage(session: DuelSession, player: 0 | 1, attackerUid: string, targetUid: string): void {
  const attack = getLegalActions(session, player).find((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
  expect(attack, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, attack!);
  passUntilBattleWindow(session, "duringDamageCalculation");
}

function passUntilBattleWindow(session: DuelSession, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
