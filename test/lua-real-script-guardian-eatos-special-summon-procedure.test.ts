import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Guardian Eatos Special Summon procedure", () => {
  it("restores its empty-Graveyard hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const eatosCode = "34022290";
    const graveMonsterCode = "601049";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === eatosCode),
      { code: graveMonsterCode, name: "Guardian Eatos Graveyard Blocker", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [eatosCode, graveMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const eatos = session.state.cards.find((card) => card.code === eatosCode);
    const blocker = session.state.cards.find((card) => card.code === graveMonsterCode);
    expect(eatos).toBeDefined();
    expect(blocker).toBeDefined();
    moveDuelCard(session.state, eatos!.uid, "hand", 0);
    moveDuelCard(session.state, blocker!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(eatosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBlocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBlocked);
    expect(getLuaRestoreLegalActionGroups(restoredBlocked, 0)).toEqual(getGroupedDuelLegalActions(restoredBlocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0)).toEqual(getDuelLegalActions(restoredBlocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredBlocked, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === eatos!.uid)).toBe(false);

    moveDuelCard(restoredBlocked.session.state, blocker!.uid, "deck", 0);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredBlocked.session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(getLuaRestoreLegalActionGroups(restoredOpen, 0)).toEqual(getGroupedDuelLegalActions(restoredOpen.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpen, 0));
    expect(getLuaRestoreLegalActions(restoredOpen, 0)).toEqual(getDuelLegalActions(restoredOpen.session, 0));
    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === eatos!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, procedure!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === eatos!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === blocker!.uid)).toMatchObject({ location: "deck" });
    expect(restoredOpen.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: eatos!.uid })]),
    );
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
