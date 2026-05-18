import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Steamroid battle swing stat", () => {
  it("restores Damage Step attacker boost and defender loss callbacks into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const steamroidCode = "44729197";
    const defenderCode = "44729198";
    const attackerCode = "44729199";
    const script = workspace.readScript(`official/c${steamroidCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("local ph=Duel.GetCurrentPhase()");
    expect(script).toContain("return ph==PHASE_DAMAGE or ph==PHASE_DAMAGE_CAL");
    expect(script).toContain("if Duel.GetAttacker()==e:GetHandler() and Duel.GetAttackTarget()~=nil then return 500");
    expect(script).toContain("elseif e:GetHandler()==Duel.GetAttackTarget() then return -500");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === steamroidCode),
      { code: defenderCode, name: "Steamroid Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
      { code: attackerCode, name: "Steamroid Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const attacking = createSteamroidBattle({ steamroidCode, opposingCode: defenderCode, cards, steamroidAttacks: true });
    const attackingHost = createLuaScriptHost(attacking.session, workspace);
    expect(attackingHost.loadCardScript(Number(steamroidCode), workspace).ok).toBe(true);
    expect(attackingHost.registerInitialEffects()).toBe(1);
    expect(attacking.session.state.effects.filter((effect) => effect.sourceUid === attacking.steamroid.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        code: 100,
        event: "continuous",
        id: "lua-1-100",
        luaConditionDescriptor: "condition:damage-or-damage-calculation",
        luaValueDescriptor: "stat:battle-attacker-target-swing:500:-500",
        range: ["monsterZone"],
        sourceUid: attacking.steamroid.uid,
      },
    ]);
    expect(currentAttack(attacking.steamroid, attacking.session.state)).toBe(attacking.steamroid.data.attack ?? 0);
    declareAndPassToDamage(attacking.session, attacking.steamroid.uid, attacking.opposing.uid);
    expect(currentAttack(attacking.steamroid, attacking.session.state)).toBe((attacking.steamroid.data.attack ?? 0) + 500);

    const restoredAttacking = restoreDuelWithLuaScripts(serializeDuel(attacking.session), workspace, reader);
    expectCleanRestore(restoredAttacking);
    expect(restoredAttacking.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restoredAttacking.session.state.eventHistory.filter((event) => event.eventName === "damageCalculating")).toEqual([
      {
        eventName: "damageCalculating",
        eventCode: 1135,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          location: "deck",
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          controller: 0,
          location: "monsterZone",
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventUids: [attacking.steamroid.uid, attacking.opposing.uid],
        eventCardUid: attacking.steamroid.uid,
      },
    ]);
    const restoredAttackingSteamroid = restoredAttacking.session.state.cards.find((card) => card.uid === attacking.steamroid.uid)!;
    expect(currentAttack(restoredAttackingSteamroid, restoredAttacking.session.state)).toBe((attacking.steamroid.data.attack ?? 0) + 500);
    passRestoredBattleResponses(restoredAttacking);
    expect(restoredAttacking.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
    expect(restoredAttacking.session.state.players[1].lifePoints).toBe(7700);
    expect(restoredAttacking.session.state.cards.find((card) => card.uid === attacking.opposing.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredAttacking.session.state.cards.find((card) => card.uid === attacking.steamroid.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const defending = createSteamroidBattle({ steamroidCode, opposingCode: attackerCode, cards, steamroidAttacks: false });
    const defendingHost = createLuaScriptHost(defending.session, workspace);
    expect(defendingHost.loadCardScript(Number(steamroidCode), workspace).ok).toBe(true);
    expect(defendingHost.registerInitialEffects()).toBe(1);
    expect(currentAttack(defending.steamroid, defending.session.state)).toBe(defending.steamroid.data.attack ?? 0);
    declareAndPassToDamage(defending.session, defending.opposing.uid, defending.steamroid.uid);
    expect(currentAttack(defending.steamroid, defending.session.state)).toBe((defending.steamroid.data.attack ?? 0) - 500);

    const restoredDefending = restoreDuelWithLuaScripts(serializeDuel(defending.session), workspace, reader);
    expectCleanRestore(restoredDefending);
    expect(restoredDefending.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restoredDefending.session.state.eventHistory.filter((event) => event.eventName === "damageCalculating")).toEqual([
      {
        eventName: "damageCalculating",
        eventCode: 1135,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          location: "deck",
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          controller: 1,
          location: "monsterZone",
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventUids: [defending.opposing.uid, defending.steamroid.uid],
        eventCardUid: defending.opposing.uid,
      },
    ]);
    const restoredDefendingSteamroid = restoredDefending.session.state.cards.find((card) => card.uid === defending.steamroid.uid)!;
    expect(currentAttack(restoredDefendingSteamroid, restoredDefending.session.state)).toBe((defending.steamroid.data.attack ?? 0) - 500);
    passRestoredBattleResponses(restoredDefending);
    expect(restoredDefending.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(restoredDefending.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredDefending.session.state.cards.find((card) => card.uid === defending.steamroid.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredDefending.session.state.cards.find((card) => card.uid === defending.opposing.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function createSteamroidBattle(args: { steamroidCode: string; opposingCode: string; cards: DuelCardData[]; steamroidAttacks: boolean }) {
  const reader = createCardReader(args.cards);
  const session = createDuel({ seed: args.steamroidAttacks ? 4472 : 4473, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [args.steamroidCode] }, 1: { main: [args.opposingCode] } });
  startDuel(session);
  const steamroid = session.state.cards.find((card) => card.code === args.steamroidCode)!;
  const opposing = session.state.cards.find((card) => card.code === args.opposingCode)!;
  moveDuelCard(session.state, steamroid.uid, "monsterZone", 0).position = "faceUpAttack";
  steamroid.faceUp = true;
  moveDuelCard(session.state, opposing.uid, "monsterZone", 1).position = "faceUpAttack";
  opposing.faceUp = true;
  session.state.phase = "battle";
  session.state.turnPlayer = args.steamroidAttacks ? 0 : 1;
  session.state.waitingFor = session.state.turnPlayer;
  return { session, steamroid, opposing };
}

function declareAndPassToDamage(session: DuelSession, attackerUid: string, targetUid: string): void {
  const attack = getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid,
  );
  expect(attack, JSON.stringify(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
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
  expect(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer)).toEqual(getGroupedDuelLegalActions(restored.session, restored.session.state.waitingFor ?? restored.session.state.turnPlayer));
  expect(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
