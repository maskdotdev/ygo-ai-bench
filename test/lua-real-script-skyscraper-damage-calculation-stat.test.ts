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
const setElementalHero = 0x3008;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Skyscraper damage-calculation stat", () => {
  it("restores PHASE_DAMAGE_CAL attacker-vs-target field ATK boost into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const skyscraperCode = "63035430";
    const heroCode = "63035431";
    const defenderCode = "63035432";
    const script = workspace.readScript(`c${skyscraperCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
    expect(script).toContain("return c==Duel.GetAttacker() and c:IsSetCard(SET_ELEMENTAL_HERO)");
    expect(script).toContain("if s[0] or c:GetAttack()<d:GetAttack() then");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === skyscraperCode),
      { code: heroCode, name: "Skyscraper Elemental HERO", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200, setcodes: [setElementalHero] },
      { code: defenderCode, name: "Skyscraper Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skyscraperCode, heroCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const skyscraper = session.state.cards.find((card) => card.code === skyscraperCode);
    const hero = session.state.cards.find((card) => card.code === heroCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(skyscraper).toBeDefined();
    expect(hero).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, skyscraper!.uid, "spellTrapZone", 0);
    skyscraper!.position = "faceUpAttack";
    skyscraper!.faceUp = true;
    moveDuelCard(session.state, hero!.uid, "monsterZone", 0);
    hero!.position = "faceUpAttack";
    hero!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skyscraperCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === skyscraper!.uid && effect.code === 100)).toMatchObject({
      code: 100,
      event: "continuous",
      luaValueDescriptor: "stat:damage-calculation-attacker-lower-than-target:+1000",
      range: ["spellTrapZone"],
      sourceUid: skyscraper!.uid,
      targetRange: [4, 4],
    });
    expect(currentAttack(hero, session.state)).toBe(1600);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === hero!.uid && action.targetUid === defender!.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilBattleWindow(session, "duringDamageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(hero, session.state)).toBe(2600);

    const restoredDamageCalculation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredDamageCalculation.restoreComplete, restoredDamageCalculation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageCalculation.missingRegistryKeys).toEqual([]);
    expect(restoredDamageCalculation.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredDamageCalculation.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restoredDamageCalculation.session.state.eventHistory.filter((event) => event.eventName === "damageCalculating")).toEqual([
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
        eventUids: [hero!.uid, defender!.uid],
        eventCardUid: hero!.uid,
      },
    ]);
    expect(getLuaRestoreLegalActionGroups(restoredDamageCalculation, 0)).toEqual(getGroupedDuelLegalActions(restoredDamageCalculation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredDamageCalculation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredDamageCalculation, 0));
    const restoredHero = restoredDamageCalculation.session.state.cards.find((card) => card.uid === hero!.uid);
    expect(currentAttack(restoredHero, restoredDamageCalculation.session.state)).toBe(2600);

    passRestoredBattleResponses(restoredDamageCalculation);
    expect(restoredDamageCalculation.session.state.battleDamage).toEqual({ 0: 0, 1: 700 });
    expect(restoredDamageCalculation.session.state.players[1].lifePoints).toBe(7300);
    expect(restoredDamageCalculation.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredDamageCalculation.session.state.cards.find((card) => card.uid === hero!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
