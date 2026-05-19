import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Self-Destruct Button SetLP draw", () => {
  it("restores GetLP activation condition and defers paired SetLP defeat into a draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const selfDestructCode = "57585212";
    const script = workspace.readScript(`c${selfDestructCode}.lua`);
    expect(script).toContain("Duel.GetLP(tp)<=Duel.GetLP(1-tp)-7000");
    expect(script).toContain("Duel.SetLP(tp,0)");
    expect(script).toContain("Duel.SetLP(1-tp,0)");
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === selfDestructCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5758, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [selfDestructCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.players[0].lifePoints = 1000;
    session.state.players[1].lifePoints = 8000;
    const selfDestruct = session.state.cards.find((card) => card.code === selfDestructCode);
    expect(selfDestruct).toBeDefined();
    moveDuelCard(session.state, selfDestruct!.uid, "spellTrapZone", 0);
    selfDestruct!.position = "faceDown";
    selfDestruct!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(selfDestructCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action) => action.type === "activateEffect" && action.uid === selfDestruct!.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.status).toBe("ended");
    expect(restoredActivation.session.state.winner).toBe("draw");
    expect(restoredActivation.session.state.players[0].lifePoints).toBe(0);
    expect(restoredActivation.session.state.players[1].lifePoints).toBe(0);
    expect(restoredActivation.session.state.log.filter((entry) => entry.action === "win")).toEqual([
      expect.objectContaining({ action: "win", detail: "lp" }),
    ]);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
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
