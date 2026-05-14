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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fusion Devourer field stat", () => {
  it("restores and applies Fusion Devourer's targeted field ATK-final effect during battle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const devourerCode = "98336111";
    const fusionCode = "1130";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === devourerCode),
      { code: fusionCode, name: "Fusion Devourer Target", kind: "monster", typeFlags: 0x41, level: 6, attack: 2500, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 983, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [devourerCode] }, 1: { main: [fusionCode] } });
    startDuel(session);

    const devourer = session.state.cards.find((card) => card.code === devourerCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    expect(devourer).toBeDefined();
    expect(fusion).toBeDefined();
    moveDuelCard(session.state, devourer!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, fusion!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(devourerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 102,
          sourceUid: devourer!.uid,
          targetRange: [0, 0x04],
          value: 0,
        }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === devourer!.uid && action.targetUid === fusion!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    applyAndAssert(session, getLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    expect(session.state.battleWindow?.kind).toBe("startDamageStep");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 102,
          sourceUid: devourer!.uid,
          targetRange: [0, 0x04],
          value: 0,
        }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[1]).toBe(devourer!.data.attack);
    expect(restored.session.state.players[1].lifePoints).toBe(8000 - (devourer!.data.attack ?? 0));
    expect(restored.session.state.cards.find((card) => card.uid === devourer!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "graveyard" });
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
