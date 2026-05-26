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
const raceDragon = 0x2000;
const raceDinosaur = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Jurassic World TargetBoolFunction race stat", () => {
  it("restores aux.TargetBoolFunction Card.IsRace ATK and DEF field updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jurassicWorldCode = "10080320";
    const dinosaurAttackerCode = "10080321";
    const dinosaurDefenderCode = "10080322";
    const dragonTargetCode = "10080323";
    const script = workspace.readScript(`c${jurassicWorldCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_DINOSAUR))");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === jurassicWorldCode),
      { code: dinosaurAttackerCode, name: "Jurassic World Dinosaur Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceDinosaur },
      { code: dinosaurDefenderCode, name: "Jurassic World Dinosaur Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1600, race: raceDinosaur },
      { code: dragonTargetCode, name: "Jurassic World Dragon Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200, race: raceDragon },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1008, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jurassicWorldCode, dinosaurAttackerCode, dinosaurDefenderCode] }, 1: { main: [dragonTargetCode] } });
    startDuel(session);

    const jurassicWorld = session.state.cards.find((card) => card.code === jurassicWorldCode);
    const dinosaurAttacker = session.state.cards.find((card) => card.code === dinosaurAttackerCode);
    const dinosaurDefender = session.state.cards.find((card) => card.code === dinosaurDefenderCode);
    const dragonTarget = session.state.cards.find((card) => card.code === dragonTargetCode);
    expect(jurassicWorld).toBeDefined();
    expect(dinosaurAttacker).toBeDefined();
    expect(dinosaurDefender).toBeDefined();
    expect(dragonTarget).toBeDefined();
    moveDuelCard(session.state, jurassicWorld!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, dinosaurAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, dinosaurDefender!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, dragonTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jurassicWorldCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === jurassicWorld!.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
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
        luaTargetDescriptor: "target:race:65536",
        range: ["spellTrapZone"],
        sourceUid: jurassicWorld!.uid,
        targetRange: [4, 4],
        value: 300,
      },
      {
        code: 104,
        controller: 0,
        id: "lua-3-104",
        luaTargetDescriptor: "target:race:65536",
        range: ["spellTrapZone"],
        sourceUid: jurassicWorld!.uid,
        targetRange: [4, 4],
        value: 300,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredDinosaurAttacker = restored.session.state.cards.find((card) => card.uid === dinosaurAttacker!.uid)!;
    const restoredDinosaurDefender = restored.session.state.cards.find((card) => card.uid === dinosaurDefender!.uid)!;
    const restoredDragonTarget = restored.session.state.cards.find((card) => card.uid === dragonTarget!.uid)!;
    expect(currentAttack(restoredDinosaurAttacker, restored.session.state)).toBe(1300);
    expect(currentDefense(restoredDinosaurAttacker, restored.session.state)).toBe(1300);
    expect(currentAttack(restoredDinosaurDefender, restored.session.state)).toBe(1200);
    expect(currentDefense(restoredDinosaurDefender, restored.session.state)).toBe(1900);
    expect(currentAttack(restoredDragonTarget, restored.session.state)).toBe(1200);
    expect(currentDefense(restoredDragonTarget, restored.session.state)).toBe(1200);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === dinosaurAttacker!.uid && action.targetUid === dragonTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(100);
    expect(restored.session.state.players[1].lifePoints).toBe(7900);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: dinosaurAttacker!.uid,
        eventPlayer: 1,
        eventValue: 100,
        eventReason: duelReason.battle,
        eventReasonCardUid: dinosaurAttacker!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === dragonTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === dinosaurAttacker!.uid)).toMatchObject({ location: "monsterZone" });
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
