import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceWingedBeast = 0x200;
const raceThunder = 0x1000;
const raceDragon = 0x2000;
const raceDinosaur = 0x10000;
const mountainRaceMask = raceDragon | raceWingedBeast | raceThunder;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mountain multi-race TargetBoolFunction stat", () => {
  it("restores multi-race aux.TargetBoolFunction Card.IsRace ATK and DEF field updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mountainCode = "50913601";
    const dragonAttackerCode = "5091360101";
    const wingedBeastAllyCode = "5091360102";
    const thunderAllyCode = "5091360103";
    const dinosaurTargetCode = "5091360104";
    const script = workspace.readScript(`c${mountainCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_DRAGON|RACE_WINGEDBEAST|RACE_THUNDER))");
    expect(script).toContain("e2:SetValue(200)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetValue(200)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mountainCode),
      { code: dragonAttackerCode, name: "Mountain Dragon Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceDragon },
      { code: wingedBeastAllyCode, name: "Mountain Winged Beast Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1600, race: raceWingedBeast },
      { code: thunderAllyCode, name: "Mountain Thunder Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 700, defense: 1400, race: raceThunder },
      { code: dinosaurTargetCode, name: "Mountain Dinosaur Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceDinosaur },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5091, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mountainCode, dragonAttackerCode, wingedBeastAllyCode, thunderAllyCode] }, 1: { main: [dinosaurTargetCode] } });
    startDuel(session);

    const mountain = session.state.cards.find((card) => card.code === mountainCode);
    const dragonAttacker = session.state.cards.find((card) => card.code === dragonAttackerCode);
    const wingedBeastAlly = session.state.cards.find((card) => card.code === wingedBeastAllyCode);
    const thunderAlly = session.state.cards.find((card) => card.code === thunderAllyCode);
    const dinosaurTarget = session.state.cards.find((card) => card.code === dinosaurTargetCode);
    expect(mountain).toBeDefined();
    expect(dragonAttacker).toBeDefined();
    expect(wingedBeastAlly).toBeDefined();
    expect(thunderAlly).toBeDefined();
    expect(dinosaurTarget).toBeDefined();
    moveDuelCard(session.state, mountain!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, dragonAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, wingedBeastAlly!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, thunderAlly!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, dinosaurTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mountainCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === mountain!.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
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
        luaTargetDescriptor: `target:race:${mountainRaceMask}`,
        range: ["spellTrapZone"],
        sourceUid: mountain!.uid,
        targetRange: [4, 4],
        value: 200,
      },
      {
        code: 104,
        controller: 0,
        id: "lua-3-104",
        luaTargetDescriptor: `target:race:${mountainRaceMask}`,
        range: ["spellTrapZone"],
        sourceUid: mountain!.uid,
        targetRange: [4, 4],
        value: 200,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredDragonAttacker = restored.session.state.cards.find((card) => card.uid === dragonAttacker!.uid)!;
    const restoredWingedBeastAlly = restored.session.state.cards.find((card) => card.uid === wingedBeastAlly!.uid)!;
    const restoredThunderAlly = restored.session.state.cards.find((card) => card.uid === thunderAlly!.uid)!;
    const restoredDinosaurTarget = restored.session.state.cards.find((card) => card.uid === dinosaurTarget!.uid)!;
    expect(currentAttack(restoredDragonAttacker, restored.session.state)).toBe(1200);
    expect(currentDefense(restoredDragonAttacker, restored.session.state)).toBe(1200);
    expect(currentAttack(restoredWingedBeastAlly, restored.session.state)).toBe(1100);
    expect(currentDefense(restoredWingedBeastAlly, restored.session.state)).toBe(1800);
    expect(currentAttack(restoredThunderAlly, restored.session.state)).toBe(900);
    expect(currentDefense(restoredThunderAlly, restored.session.state)).toBe(1600);
    expect(currentAttack(restoredDinosaurTarget, restored.session.state)).toBe(1000);
    expect(currentDefense(restoredDinosaurTarget, restored.session.state)).toBe(1000);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === dragonAttacker!.uid && action.targetUid === dinosaurTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(200);
    expect(restored.session.state.players[1].lifePoints).toBe(7800);
    expect(restored.session.state.cards.find((card) => card.uid === dinosaurTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === dragonAttacker!.uid)).toMatchObject({ location: "monsterZone" });
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
