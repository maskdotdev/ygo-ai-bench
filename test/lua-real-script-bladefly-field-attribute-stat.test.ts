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
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Bladefly field attribute stat", () => {
  it("restores cloned field ATK updates for WIND boost and EARTH loss into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bladeflyCode = "28470714";
    const windAllyCode = "28470715";
    const earthTargetCode = "28470716";
    const fireTargetCode = "28470717";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bladeflyCode),
      { code: windAllyCode, name: "Bladefly WIND Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeWind },
      { code: earthTargetCode, name: "Bladefly EARTH Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000, attribute: attributeEarth },
      { code: fireTargetCode, name: "Bladefly FIRE Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000, attribute: attributeFire },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2847, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bladeflyCode, windAllyCode] }, 1: { main: [earthTargetCode, fireTargetCode] } });
    startDuel(session);

    const bladefly = session.state.cards.find((card) => card.code === bladeflyCode);
    const windAlly = session.state.cards.find((card) => card.code === windAllyCode);
    const earthTarget = session.state.cards.find((card) => card.code === earthTargetCode);
    const fireTarget = session.state.cards.find((card) => card.code === fireTargetCode);
    expect(bladefly).toBeDefined();
    expect(windAlly).toBeDefined();
    expect(earthTarget).toBeDefined();
    expect(fireTarget).toBeDefined();
    moveDuelCard(session.state, bladefly!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, windAlly!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, earthTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, fireTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bladeflyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === bladefly!.uid && effect.code === 100).map((effect) => ({
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
        id: "lua-1-100",
        luaTargetDescriptor: "target:attribute:8",
        range: ["monsterZone"],
        sourceUid: bladefly!.uid,
        targetRange: [4, 4],
        value: 500,
      },
      {
        code: 100,
        controller: 0,
        id: "lua-2-100",
        luaTargetDescriptor: "target:attribute:1",
        range: ["monsterZone"],
        sourceUid: bladefly!.uid,
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

    const restoredBladefly = restored.session.state.cards.find((card) => card.uid === bladefly!.uid)!;
    const restoredWindAlly = restored.session.state.cards.find((card) => card.uid === windAlly!.uid)!;
    const restoredEarthTarget = restored.session.state.cards.find((card) => card.uid === earthTarget!.uid)!;
    const restoredFireTarget = restored.session.state.cards.find((card) => card.uid === fireTarget!.uid)!;
    expect(currentAttack(restoredBladefly, restored.session.state)).toBe((bladefly!.data.attack ?? 0) + 500);
    expect(currentAttack(restoredWindAlly, restored.session.state)).toBe(1500);
    expect(currentAttack(restoredEarthTarget, restored.session.state)).toBe(1200);
    expect(currentAttack(restoredFireTarget, restored.session.state)).toBe(1700);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === windAlly!.uid && action.targetUid === earthTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(300);
    expect(restored.session.state.players[1].lifePoints).toBe(7700);
    expect(restored.session.state.cards.find((card) => card.uid === earthTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === windAlly!.uid)).toMatchObject({ location: "monsterZone" });
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
