import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nikitama extra Spirit summon", () => {
  it("restores its official additional Spirit Normal Summon count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nikitamaCode = "24701235";
    const spiritCodes = ["94701235", "94701236"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nikitamaCode),
      ...spiritCodes.map((code, index) => ({
        code,
        name: `Nikitama Spirit Target ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect | typeSpirit,
        level: 4,
        attack: 1600,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 327, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nikitamaCode, ...spiritCodes] }, 1: { main: [] } });
    startDuel(session);

    const nikitama = session.state.cards.find((card) => card.code === nikitamaCode && card.location === "deck");
    const spiritTargets = spiritCodes.map((code) => session.state.cards.find((card) => card.code === code && card.location === "deck"));
    expect(nikitama).toBeDefined();
    expect(spiritTargets.every(Boolean)).toBe(true);
    moveDuelCard(session.state, nikitama!.uid, "hand", 0);
    for (const target of spiritTargets) moveDuelCard(session.state, target!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nikitamaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restoredNikitamaWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredNikitamaWindow.restoreComplete, restoredNikitamaWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredNikitamaWindow, 0)).toEqual(getDuelLegalActions(restoredNikitamaWindow.session, 0));
    const nikitamaSummon = getLuaRestoreLegalActions(restoredNikitamaWindow, 0).find((action) => action.type === "normalSummon" && action.uid === nikitama!.uid);
    expect(nikitamaSummon, JSON.stringify(getLuaRestoreLegalActions(restoredNikitamaWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNikitamaWindow, nikitamaSummon!);
    expect(restoredNikitamaWindow.session.state.players[0].normalSummonAvailable).toBe(false);

    const restoredExtraWindow = restoreDuelWithLuaScripts(serializeDuel(restoredNikitamaWindow.session), workspace, reader);
    expect(restoredExtraWindow.restoreComplete, restoredExtraWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredExtraWindow, 0)).toEqual(getDuelLegalActions(restoredExtraWindow.session, 0));
    const extraSummon = getLuaRestoreLegalActions(restoredExtraWindow, 0).find((action) => action.type === "normalSummon" && action.uid === spiritTargets[0]!.uid);
    expect(extraSummon, JSON.stringify(getLuaRestoreLegalActions(restoredExtraWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredExtraWindow, extraSummon!);
    expect(restoredExtraWindow.session.state.cards.find((card) => card.uid === spiritTargets[0]!.uid)).toMatchObject({ location: "monsterZone", summonType: "normal" });

    const overLimit = getLuaRestoreLegalActions(restoredExtraWindow, 0).find((action) => action.type === "normalSummon" && action.uid === spiritTargets[1]!.uid);
    expect(overLimit).toBeUndefined();
  });
});

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
