import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Miracle Locus temporary no battle damage", () => {
  it("restores its temporary ATK, extra monster attack, and opponent-only battle-damage suppression", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const miracleLocusCode = "97168905";
    const targetCode = "97160001";
    const wallCode = "97160002";
    const followupCode = "97160003";
    const drawCode = "97160004";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === miracleLocusCode),
      { code: targetCode, name: "Miracle Locus Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: wallCode, name: "Miracle Locus Stronger Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2800, defense: 1000 },
      { code: followupCode, name: "Miracle Locus Followup Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: drawCode, name: "Miracle Locus Draw Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9716, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [miracleLocusCode, targetCode] }, 1: { main: [wallCode, followupCode, drawCode] } });
    startDuel(session);

    const miracleLocus = session.state.cards.find((card) => card.code === miracleLocusCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const wall = session.state.cards.find((card) => card.code === wallCode);
    const followup = session.state.cards.find((card) => card.code === followupCode);
    const drawProbe = session.state.cards.find((card) => card.code === drawCode);
    expect(miracleLocus).toBeDefined();
    expect(target).toBeDefined();
    expect(wall).toBeDefined();
    expect(followup).toBeDefined();
    expect(drawProbe).toBeDefined();
    moveDuelCard(session.state, miracleLocus!.uid, "spellTrapZone", 0);
    miracleLocus!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    moveDuelCard(session.state, wall!.uid, "monsterZone", 1);
    wall!.faceUp = true;
    wall!.position = "faceUpAttack";
    moveDuelCard(session.state, followup!.uid, "monsterZone", 1);
    followup!.faceUp = true;
    followup!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(miracleLocusCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action) => action.type === "activateEffect" && action.uid === miracleLocus!.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([]);

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEffects.missingRegistryKeys).toEqual([]);
    expect(restoredEffects.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEffects, restoredEffects.session.state.waitingFor ?? restoredEffects.session.state.turnPlayer);
    expect(restoredEffects.session.state.cards.find((card) => card.uid === drawProbe!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredEffects.session.state.effects.filter((effect) => effect.sourceUid === target!.uid && [100, 200, 346].includes(effect.code ?? -1))).toMatchObject([
      {
        code: 100,
        controller: 0,
        event: "continuous",
        range: ["monsterZone"],
        registryKey: "lua:97168905:lua-2-100",
        sourceUid: target!.uid,
        value: 1000,
      },
      {
        code: 346,
        controller: 0,
        event: "continuous",
        range: ["monsterZone"],
        registryKey: "lua:97168905:lua-3-346",
        sourceUid: target!.uid,
        value: 1,
      },
      {
        code: 200,
        controller: 0,
        event: "continuous",
        range: ["monsterZone"],
        registryKey: "lua:97168905:lua-4-200",
        sourceUid: target!.uid,
      },
    ]);

    restoredEffects.session.state.phase = "battle";
    restoredEffects.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredEffects, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredEffects, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.targetUid === wall!.uid,
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredEffects, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEffects, firstAttack!);
    passBattleResponses(restoredEffects);

    expect(restoredEffects.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredEffects.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredEffects.session.state.battleDamage).toEqual({ 0: 800, 1: 0 });
    expect(restoredEffects.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredEffects.session.state.cards.find((card) => card.uid === wall!.uid)).toMatchObject({ location: "monsterZone" });
    expect(
      restoredEffects.session.state.eventHistory
        .filter((event) => event.eventName === "battleDamageDealt")
        .map((event) => ({ eventName: event.eventName, eventPlayer: event.eventPlayer, eventValue: event.eventValue })),
    ).toEqual([{ eventName: "battleDamageDealt", eventPlayer: 0, eventValue: 800 }]);
    expect(restoredEffects.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt" && event.eventPlayer === 1)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredEffects, 0).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid)).toBe(false);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
