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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Burning Bamboo Sword Main Phase 1 skip", () => {
  it("restores its official EVENT_CHAINING trigger into an opponent Main Phase 1 skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const burningCode = "55870497";
    const brokenCode = "41587307";
    const equipTargetCode = "55870498";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === burningCode || card.code === brokenCode),
      { code: equipTargetCode, name: "Burning Bamboo Equip Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 558, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [burningCode, brokenCode, equipTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const burning = requireCard(session, burningCode);
    const broken = requireCard(session, brokenCode);
    const target = requireCard(session, equipTargetCode);
    moveDuelCard(session.state, burning.uid, "spellTrapZone", 0);
    burning.faceUp = true;
    moveDuelCard(session.state, broken.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 0);
    target.faceUp = true;
    target.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(burningCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(brokenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const activateBroken = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === broken.uid);
    expect(activateBroken, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, activateBroken);
    passChainUntilOpen(session);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: burning.uid, eventName: "chaining", eventCode: 1027, player: 0 })]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === burning.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(result.ok, result.error).toBe(true);
    passChainUntilOpen(restoredTrigger.session);
    expect(restoredTrigger.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: burning.uid, event: "continuous", code: 182, targetRange: [0, 1], reset: { flags: 0x60000200 } })]),
    );
    // Isolate the generated phase lock; the chain event can leave Burning's optional watcher available again.
    restoredTrigger.session.state.pendingTriggers = [];

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    moveToBattleMain2AndEnd(restoredLock.session, 0);
    expect(restoredLock.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1 });
    const opponentActions = getLuaRestoreLegalActions(restoreDuelWithLuaScripts(serializeDuel(restoredLock.session), workspace, reader), 1);
    expect(opponentActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    expect(opponentActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon" })]));
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

function moveToBattleMain2AndEnd(session: DuelSession, player: 0 | 1): void {
  for (const phase of ["battle", "main2"] as const) {
    applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === phase));
  }
  applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "endTurn"));
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
