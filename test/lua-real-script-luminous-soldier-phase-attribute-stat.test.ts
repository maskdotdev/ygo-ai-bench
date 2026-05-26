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
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Luminous Soldier phase attribute stat", () => {
  it("restores Damage Step DARK battle-target ATK update into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const luminousSoldierCode = "57482479";
    const darkTargetCode = "574824790";
    const lightTargetCode = "574824791";
    const script = workspace.readScript(`official/c${luminousSoldierCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("local ph=Duel.GetCurrentPhase()");
    expect(script).toContain("e:GetHandler():IsRelateToBattle()");
    expect(script).toContain("bc:IsFaceup() and bc:IsAttribute(ATTRIBUTE_DARK)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luminousSoldierCode),
      { code: darkTargetCode, name: "Luminous DARK Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2300, defense: 1000, attribute: attributeDark },
      { code: lightTargetCode, name: "Luminous LIGHT Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2300, defense: 1000, attribute: attributeLight },
    ];
    const reader = createCardReader(cards);
    const boosted = createLuminousBattle({ luminousSoldierCode, targetCode: darkTargetCode, cards, seed: 5748 });
    const host = createLuaScriptHost(boosted.session, workspace);
    expect(host.loadCardScript(Number(luminousSoldierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(boosted.session.state.effects.filter((effect) => effect.sourceUid === boosted.luminousSoldier.uid).map((effect) => ({
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
        luaConditionDescriptor: `condition:damage-source-relate-battle-target-faceup-attribute:${attributeDark}`,
        range: ["monsterZone"],
        sourceUid: boosted.luminousSoldier.uid,
        value: 500,
      },
    ]);
    expect(currentAttack(boosted.luminousSoldier, boosted.session.state)).toBe(boosted.luminousSoldier.data.attack ?? 0);
    declareAndPassToDamage(boosted.session, boosted.luminousSoldier.uid, boosted.target.uid);
    expect(currentAttack(boosted.luminousSoldier, boosted.session.state)).toBe((boosted.luminousSoldier.data.attack ?? 0) + 500);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(boosted.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    expect(restoredBoosted.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    const restoredBoostedSoldier = restoredBoosted.session.state.cards.find((card) => card.uid === boosted.luminousSoldier.uid)!;
    expect(currentAttack(restoredBoostedSoldier, restoredBoosted.session.state)).toBe((boosted.luminousSoldier.data.attack ?? 0) + 500);
    passRestoredBattleResponses(restoredBoosted);
    const expectedBoostedDamage = (boosted.luminousSoldier.data.attack ?? 0) + 500 - (boosted.target.data.attack ?? 0);
    expect(restoredBoosted.session.state.battleDamage).toEqual({ 0: 0, 1: expectedBoostedDamage });
    expect(restoredBoosted.session.state.players[1].lifePoints).toBe(8000 - expectedBoostedDamage);
    expect(restoredBoosted.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: boosted.luminousSoldier.uid,
        eventPlayer: 1,
        eventValue: expectedBoostedDamage,
        eventReason: duelReason.battle,
        eventReasonCardUid: boosted.luminousSoldier.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBoosted.session.state.cards.find((card) => card.uid === boosted.target.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBoosted.session.state.cards.find((card) => card.uid === boosted.luminousSoldier.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const unboosted = createLuminousBattle({ luminousSoldierCode, targetCode: lightTargetCode, cards, seed: 5749 });
    const unboostedHost = createLuaScriptHost(unboosted.session, workspace);
    expect(unboostedHost.loadCardScript(Number(luminousSoldierCode), workspace).ok).toBe(true);
    expect(unboostedHost.registerInitialEffects()).toBe(1);
    declareAndPassToDamage(unboosted.session, unboosted.luminousSoldier.uid, unboosted.target.uid);
    expect(currentAttack(unboosted.luminousSoldier, unboosted.session.state)).toBe(unboosted.luminousSoldier.data.attack ?? 0);
    const restoredUnboosted = restoreDuelWithLuaScripts(serializeDuel(unboosted.session), workspace, reader);
    expectCleanRestore(restoredUnboosted);
    const restoredUnboostedSoldier = restoredUnboosted.session.state.cards.find((card) => card.uid === unboosted.luminousSoldier.uid)!;
    expect(currentAttack(restoredUnboostedSoldier, restoredUnboosted.session.state)).toBe(unboosted.luminousSoldier.data.attack ?? 0);
  });
});

function createLuminousBattle(args: { luminousSoldierCode: string; targetCode: string; cards: DuelCardData[]; seed: number }) {
  const reader = createCardReader(args.cards);
  const session = createDuel({ seed: args.seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [args.luminousSoldierCode] }, 1: { main: [args.targetCode] } });
  startDuel(session);
  const luminousSoldier = session.state.cards.find((card) => card.code === args.luminousSoldierCode)!;
  const target = session.state.cards.find((card) => card.code === args.targetCode)!;
  moveDuelCard(session.state, luminousSoldier.uid, "monsterZone", 0).position = "faceUpAttack";
  luminousSoldier.faceUp = true;
  moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
  target.faceUp = true;
  session.state.phase = "battle";
  session.state.waitingFor = 0;
  return { session, luminousSoldier, target };
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
