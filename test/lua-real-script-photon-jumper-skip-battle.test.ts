import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Photon Jumper Battle Phase skip", () => {
  it("restores its official hand trigger into a self-turn Battle Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jumperCode = "97639441";
    const attackerCode = "97639442";
    const targetCode = "97639443";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === jumperCode),
      { code: attackerCode, name: "Photon Jumper Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: targetCode, name: "Photon Jumper Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 976, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jumperCode, targetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const jumper = requireCard(session, jumperCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, jumper.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 0);
    target.faceUp = true;
    target.position = "faceUpAttack";
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    attacker.faceUp = true;
    attacker.position = "faceUpAttack";
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jumperCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const attack = getDuelLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getDuelLegalActions(session, 1), null, 2)).toBeDefined();
    applyActionAndAssert(session, attack);
    if (session.state.waitingFor === 1) applyActionAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack"));

    const restoredWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredWindow.restoreComplete, restoredWindow.incompleteReasons.join("; ")).toBe(true);
    const activate = getLuaRestoreLegalActions(restoredWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === jumper.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredWindow, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restoredWindow, activate!);
    expect(result.ok, result.error).toBe(true);
    passChainUntilOpen(restoredWindow.session);
    expect(restoredWindow.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: jumper.uid, event: "continuous", code: 183, targetRange: [1, 0], reset: expect.objectContaining({ flags: 0x50000080, count: 1 }) })]),
    );

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredWindow.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    // Photon also ends the current Battle Phase; isolate the lingering self-turn lock after that current-turn skip.
    delete restoredLock.session.state.pendingBattle;
    delete restoredLock.session.state.currentAttack;
    restoredLock.session.state.phase = "main2";
    restoredLock.session.state.waitingFor = 1;
    applyActionAndAssert(restoredLock.session, getDuelLegalActions(restoredLock.session, 1).find((action) => action.type === "endTurn"));
    expect(restoredLock.session.state).toMatchObject({ turnPlayer: 0, phase: "main1", waitingFor: 0 });
    const selfActions = getLuaRestoreLegalActions(restoreDuelWithLuaScripts(serializeDuel(restoredLock.session), workspace, reader), 0);
    expect(selfActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
    expect(selfActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
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
