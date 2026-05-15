import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Terminal World Main Phase 2 skip", () => {
  it("restores persistent EFFECT_SKIP_M2 legal actions from the official script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const terminalWorldCode = "54631834";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === terminalWorldCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 546, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [terminalWorldCode] }, 1: { main: [] } });
    startDuel(session);

    const terminalWorld = requireCard(session, terminalWorldCode);
    moveDuelCard(session.state, terminalWorld.uid, "spellTrapZone", 0);
    terminalWorld.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(terminalWorldCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: terminalWorld.uid,
          code: 184,
          controller: 0,
          targetRange: [1, 1],
          range: ["spellTrapZone"],
        }),
      ]),
    );

    const restoredMain1 = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredMain1.restoreComplete, restoredMain1.incompleteReasons.join("; ")).toBe(true);
    expect(restoredMain1.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredMain1, 0)).toEqual(getGroupedDuelLegalActions(restoredMain1.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredMain1, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredMain1, 0));
    expect(getLuaRestoreLegalActions(restoredMain1, 0)).toEqual(getDuelLegalActions(restoredMain1.session, 0));
    applyActionAndAssert(restoredMain1.session, getLuaRestoreLegalActions(restoredMain1, 0).find((action) => action.type === "changePhase" && action.phase === "battle"));

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredMain1.session), workspace, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.session.state).toMatchObject({ phase: "battle", waitingFor: 0 });
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0)).toEqual(getGroupedDuelLegalActions(restoredBattle.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattle, 0));
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions).toEqual(getDuelLegalActions(restoredBattle.session, 0));
    expect(battleActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "endTurn" })]));
    expect(battleActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
