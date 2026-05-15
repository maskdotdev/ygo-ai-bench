import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Izanagi Spirit optional return", () => {
  it("restores its hand-banish Special Summon procedure and optional Spirit End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const izanagiCode = "6544078";
    const yataCode = "3078576";
    const costSpiritCode = "6544079";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === izanagiCode || card.code === yataCode),
      { code: costSpiritCode, name: "Izanagi Cost Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 654, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [izanagiCode, yataCode, costSpiritCode] }, 1: { main: [] } });
    startDuel(session);

    const izanagi = session.state.cards.find((card) => card.code === izanagiCode)!;
    const yata = session.state.cards.find((card) => card.code === yataCode)!;
    const costSpirit = session.state.cards.find((card) => card.code === costSpiritCode)!;
    expect(izanagi).toBeDefined();
    expect(yata).toBeDefined();
    expect(costSpirit).toBeDefined();
    moveDuelCard(session.state, izanagi.uid, "hand", 0);
    moveDuelCard(session.state, costSpirit.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(izanagiCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(yataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

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
    const procedure = getLuaRestoreLegalActions(restoredProcedureWindow, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === izanagi.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedureWindow, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restoredProcedureWindow, procedure!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restoredProcedureWindow.session.state.cards.find((card) => card.uid === izanagi.uid)).toMatchObject({ location: "monsterZone", summonType: "special" });
    expect(restoredProcedureWindow.session.state.cards.find((card) => card.uid === costSpirit.uid)).toMatchObject({ location: "banished", faceUp: true });

    moveDuelCard(restoredProcedureWindow.session.state, yata.uid, "hand", 0);
    applyActionAndAssert(
      restoredProcedureWindow.session,
      getDuelLegalActions(restoredProcedureWindow.session, 0).find((action) => action.type === "normalSummon" && action.uid === yata.uid),
    );
    for (const phase of ["battle", "main2", "end"] as const) {
      applyActionAndAssert(
        restoredProcedureWindow.session,
        getDuelLegalActions(restoredProcedureWindow.session, 0).find((action) => action.type === "changePhase" && action.phase === phase),
      );
    }
    const returnSnapshot = serializeDuel(restoredProcedureWindow.session);

    const restoredDecline = restoreDuelWithLuaScripts(returnSnapshot, workspace, reader);
    expect(restoredDecline.restoreComplete, restoredDecline.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDecline.missingRegistryKeys).toEqual([]);
    expect(restoredDecline.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredDecline, 0)).toEqual(getGroupedDuelLegalActions(restoredDecline.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredDecline, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredDecline, 0),
    );
    const decline = getLuaRestoreLegalActions(restoredDecline, 0).find((action) => action.type === "declineTrigger" && action.uid === yata.uid);
    expect(decline, JSON.stringify(getLuaRestoreLegalActions(restoredDecline, 0), null, 2)).toBeDefined();
    const declined = applyLuaRestoreResponse(restoredDecline, decline!);
    expect(declined.ok, declined.error).toBe(true);
    expect(restoredDecline.session.state.cards.find((card) => card.uid === yata.uid)).toMatchObject({ location: "monsterZone" });

    const restoredActivate = restoreDuelWithLuaScripts(returnSnapshot, workspace, reader);
    expect(restoredActivate.restoreComplete, restoredActivate.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivate.missingRegistryKeys).toEqual([]);
    expect(restoredActivate.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivate, 0)).toEqual(getGroupedDuelLegalActions(restoredActivate.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivate, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredActivate, 0),
    );
    const activate = getLuaRestoreLegalActions(restoredActivate, 0).find((action) => action.type === "activateTrigger" && action.uid === yata.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivate, activate!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restoredActivate);
    expect(restoredActivate.session.state.cards.find((card) => card.uid === yata.uid)).toMatchObject({ location: "hand", controller: 0 });
  });
});

function applyActionAndAssert(session: ReturnType<typeof createDuel>, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
