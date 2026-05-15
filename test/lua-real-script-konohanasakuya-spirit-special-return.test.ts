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
import {
  applyLuaRestoreResponse,
  getLuaRestoreLegalActionGroups,
  getLuaRestoreLegalActions,
  restoreDuelWithLuaScripts,
} from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Konohanasakuya Spirit procedure", () => {
  it("restores its official Special Summon procedure and Spirit End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const konohanasakuyaCode = "57722593";
    const spiritMaterialCode = "97722593";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === konohanasakuyaCode),
      {
        code: spiritMaterialCode,
        name: "Konohanasakuya Spirit Enabler",
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect | typeSpirit,
        level: 4,
        attack: 1700,
        defense: 1200,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [konohanasakuyaCode, spiritMaterialCode] }, 1: { main: [] } });
    startDuel(session);

    const konohanasakuya = session.state.cards.find((card) => card.code === konohanasakuyaCode && card.location === "deck");
    const spiritEnabler = session.state.cards.find((card) => card.code === spiritMaterialCode && card.location === "deck");
    expect(konohanasakuya).toBeDefined();
    expect(spiritEnabler).toBeDefined();
    moveDuelCard(session.state, konohanasakuya!.uid, "hand", 0);
    moveDuelCard(session.state, spiritEnabler!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(konohanasakuyaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredProcedureWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredProcedureWindow.restoreComplete, restoredProcedureWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredProcedureWindow.missingRegistryKeys).toEqual([]);
    expect(restoredProcedureWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredProcedureWindow, 0)).toEqual(
      getGroupedDuelLegalActions(restoredProcedureWindow.session, 0),
    );
    expect(getLuaRestoreLegalActionGroups(restoredProcedureWindow, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredProcedureWindow, 0),
    );
    expect(getLuaRestoreLegalActions(restoredProcedureWindow, 0)).toEqual(getDuelLegalActions(restoredProcedureWindow.session, 0));
    const procedure = getLuaRestoreLegalActions(restoredProcedureWindow, 0).find(
      (action) => action.type === "specialSummonProcedure" && action.uid === konohanasakuya!.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedureWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedureWindow, procedure!);
    expect(restoredProcedureWindow.session.state.cards.find((card) => card.uid === konohanasakuya!.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      summonType: "special",
    });

    const restoredAfterSummon = restoreDuelWithLuaScripts(serializeDuel(restoredProcedureWindow.session), workspace, reader);
    expect(restoredAfterSummon.restoreComplete, restoredAfterSummon.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterSummon.missingRegistryKeys).toEqual([]);
    expect(restoredAfterSummon.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterSummon, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterSummon.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterSummon, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredAfterSummon, 0),
    );
    advanceRestoredToEndPhase(restoredAfterSummon);

    expect(restoredAfterSummon.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-3-4608",
          "eventCode": 4608,
          "eventName": "phaseEnd",
          "eventTriggerTiming": "when",
          "id": "trigger-8-1",
          "player": 0,
          "sourceUid": "p0-deck-57722593-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const returnTrigger = getLuaRestoreLegalActions(restoredAfterSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === konohanasakuya!.uid);
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAfterSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterSummon, returnTrigger!);
    resolveRestoredChain(restoredAfterSummon);
    expect(restoredAfterSummon.session.state.cards.find((card) => card.uid === konohanasakuya!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });
});

function advanceRestoredToEndPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
