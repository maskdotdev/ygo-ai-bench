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
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Master Peace Main Phase 2 skip", () => {
  it("restores its official opponent Battle Phase destruction into a Main Phase 2 skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const masterPeaceCode = "12800564";
    const masterPeace = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === masterPeaceCode);
    expect(masterPeace).toBeDefined();
    const cards: DuelCardData[] = [masterPeace!];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 128, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [masterPeaceCode] }, 1: { main: [] } });
    startDuel(session);

    const master = requireCard(session, masterPeaceCode);
    moveDuelCard(session.state, master.uid, "monsterZone", 0);
    master.faceUp = true;
    master.position = "faceUpAttack";
    master.summonType = "tribute";
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(masterPeaceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const destroyed = host.loadScript(
      `
      local master=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${masterPeaceCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("master destroyed " .. Duel.Destroy(master,REASON_EFFECT))
      `,
      "master-peace-destroy.lua",
    );
    expect(destroyed.ok, destroyed.error).toBe(true);
    expect(host.messages).toContain("master destroyed 1");
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: master.uid, eventName: "destroyed", eventCode: 1029, player: 0 })]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredTrigger, 0),
    );
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === master.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(result.ok, result.error).toBe(true);
    passChainUntilOpen(restoredTrigger.session);
    expect(restoredTrigger.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: master.uid, event: "continuous", code: 184, targetRange: [0, 1], reset: expect.objectContaining({ flags: 0x60000200 }) })]),
    );

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredLock.session.state).toMatchObject({ turnPlayer: 1, phase: "battle", waitingFor: 1 });
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredLock, 1),
    );
    const actions = getLuaRestoreLegalActions(restoredLock, 1);
    expect(actions).toEqual(getDuelLegalActions(restoredLock.session, 1));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "end" })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passChainUntilOpen(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "passChain"));
  }
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
