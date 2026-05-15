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
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeEarth = 0x1;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Desert Twister Special Summon procedure", () => {
  it("restores its WIND/WIND/EARTH banish-cost hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const twisterCode = "81977953";
    const windACode = "81977954";
    const windBCode = "81977955";
    const earthCode = "81977956";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === twisterCode),
      monster(windACode, "Desert Twister Wind Cost A", attributeWind),
      monster(windBCode, "Desert Twister Wind Cost B", attributeWind),
      monster(earthCode, "Desert Twister Earth Cost", attributeEarth),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 819, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [twisterCode, windACode, windBCode, earthCode] }, 1: { main: [] } });
    startDuel(session);

    const twister = session.state.cards.find((card) => card.code === twisterCode);
    const windA = session.state.cards.find((card) => card.code === windACode);
    const windB = session.state.cards.find((card) => card.code === windBCode);
    const earth = session.state.cards.find((card) => card.code === earthCode);
    expect(twister).toBeDefined();
    expect(windA).toBeDefined();
    expect(windB).toBeDefined();
    expect(earth).toBeDefined();
    moveDuelCard(session.state, twister!.uid, "hand", 0);
    moveDuelCard(session.state, windA!.uid, "graveyard", 0);
    moveDuelCard(session.state, windB!.uid, "graveyard", 0);
    moveDuelCard(session.state, earth!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(twisterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === twister!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === twister!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    for (const cost of [windA, windB, earth]) {
      expect(restored.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "banished", faceUp: true });
    }
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: twister!.uid })]),
    );
  });
});

function monster(code: string, name: string, attribute: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute };
}

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
