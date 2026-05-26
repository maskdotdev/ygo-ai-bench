import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mystic Plasma Zone TargetBoolFunction attribute stat", () => {
  it("restores aux.TargetBoolFunction Card.IsAttribute ATK and DEF field updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zoneCode = "18161786";
    const darkAttackerCode = "18161787";
    const darkDefenderCode = "18161788";
    const lightTargetCode = "18161789";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zoneCode),
      { code: darkAttackerCode, name: "Mystic Plasma DARK Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeDark },
      { code: darkDefenderCode, name: "Mystic Plasma DARK Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1600, attribute: attributeDark },
      { code: lightTargetCode, name: "Mystic Plasma LIGHT Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200, attribute: attributeLight },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1816, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zoneCode, darkAttackerCode, darkDefenderCode] }, 1: { main: [lightTargetCode] } });
    startDuel(session);

    const zone = session.state.cards.find((card) => card.code === zoneCode);
    const darkAttacker = session.state.cards.find((card) => card.code === darkAttackerCode);
    const darkDefender = session.state.cards.find((card) => card.code === darkDefenderCode);
    const lightTarget = session.state.cards.find((card) => card.code === lightTargetCode);
    expect(zone).toBeDefined();
    expect(darkAttacker).toBeDefined();
    expect(darkDefender).toBeDefined();
    expect(lightTarget).toBeDefined();
    moveDuelCard(session.state, zone!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, darkAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, darkDefender!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, lightTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zoneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === zone!.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      id: effect.id,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        controller: 0,
        id: "lua-2-100",
        luaTargetDescriptor: "target:attribute:32",
        range: ["spellTrapZone"],
        sourceUid: zone!.uid,
        targetRange: [4, 4],
        value: 500,
      },
      {
        code: 104,
        controller: 0,
        id: "lua-3-104",
        luaTargetDescriptor: "target:attribute:32",
        range: ["spellTrapZone"],
        sourceUid: zone!.uid,
        targetRange: [4, 4],
        value: -400,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredDarkAttacker = restored.session.state.cards.find((card) => card.uid === darkAttacker!.uid)!;
    const restoredDarkDefender = restored.session.state.cards.find((card) => card.uid === darkDefender!.uid)!;
    const restoredLightTarget = restored.session.state.cards.find((card) => card.uid === lightTarget!.uid)!;
    expect(currentAttack(restoredDarkAttacker, restored.session.state)).toBe(1500);
    expect(currentDefense(restoredDarkAttacker, restored.session.state)).toBe(600);
    expect(currentAttack(restoredDarkDefender, restored.session.state)).toBe(1400);
    expect(currentDefense(restoredDarkDefender, restored.session.state)).toBe(1200);
    expect(currentAttack(restoredLightTarget, restored.session.state)).toBe(1200);
    expect(currentDefense(restoredLightTarget, restored.session.state)).toBe(1200);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === darkAttacker!.uid && action.targetUid === lightTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(300);
    expect(restored.session.state.players[1].lifePoints).toBe(7700);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: darkAttacker!.uid,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.battle,
        eventReasonCardUid: darkAttacker!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === lightTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === darkAttacker!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
