import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fortune Lady Past set attack", () => {
  it("restores callback-valued set ATK/DEF effects and uses them for battle calculation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pastCode = "57869175";
    const defenderCode = "1120";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pastCode),
      { code: defenderCode, name: "Fortune Lady Past Defender", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 578, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pastCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const past = session.state.cards.find((card) => card.code === pastCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(past).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, past!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pastCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 101, sourceUid: past!.uid }),
        expect.objectContaining({ event: "continuous", code: 105, sourceUid: past!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 101, sourceUid: past!.uid }),
        expect.objectContaining({ event: "continuous", code: 105, sourceUid: past!.uid }),
      ]),
    );

    const attack = getLegalActions(restored.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === past!.uid && action.targetUid === defender!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[0]).toBe(300);
    expect(restored.session.state.players[0].lifePoints).toBe(7700);
    expect(restored.session.state.cards.find((card) => card.uid === past!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "monsterZone" });
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
