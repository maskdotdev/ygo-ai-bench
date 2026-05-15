import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script battle damage prevention", () => {
  it("restores Machine Lord Ur and prevents opponent battle damage from its attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const urCode = "96938777";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === urCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 969, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [urCode] }, 1: { main: [] } });
    startDuel(session);

    const ur = session.state.cards.find((card) => card.code === urCode);
    expect(ur).toBeDefined();
    moveDuelCard(session.state, ur!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(urCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 200, sourceUid: ur!.uid }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ur!.uid && action.targetUid === undefined);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 200, sourceUid: ur!.uid }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "battleDamage", player: 1, detail: "0" }),
      ]),
    );
    expect(restored.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 1 }),
      ]),
    );
    expect(restored.session.state.cards.find((card) => card.uid === ur!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("restores Rescue Warrior and prevents its controller's battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rescueCode = "70630741";
    const wallCode = "7063";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rescueCode),
      { code: wallCode, name: "Rescue Warrior Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 2200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 706, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rescueCode] }, 1: { main: [wallCode] } });
    startDuel(session);

    const rescue = session.state.cards.find((card) => card.code === rescueCode);
    const wall = session.state.cards.find((card) => card.code === wallCode);
    expect(rescue).toBeDefined();
    expect(wall).toBeDefined();
    moveDuelCard(session.state, rescue!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, wall!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rescueCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 201, sourceUid: rescue!.uid, value: 1 }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === rescue!.uid && action.targetUid === wall!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 201, sourceUid: rescue!.uid, value: 1 }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 0 }),
      ]),
    );
    expect(restored.session.state.cards.find((card) => card.uid === rescue!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === wall!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
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
