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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Maharaghi predraw", () => {
  it("restores its delayed Draw Phase top-deck confirmation before the turn draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maharaghiCode = "40695128";
    const firstDrawCode = "94695128";
    const secondDrawCode = "94695129";
    const opponentDrawCode = "94695130";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maharaghiCode),
      { code: firstDrawCode, name: "Maharaghi First Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: secondDrawCode, name: "Maharaghi Second Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: opponentDrawCode, name: "Maharaghi Opponent Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 406, startingHandSize: 0, drawPerTurn: 1, cardReader: reader });
    loadDecks(session, { 0: { main: [maharaghiCode, firstDrawCode, secondDrawCode] }, 1: { main: [opponentDrawCode] } });
    startDuel(session);

    const maharaghi = session.state.cards.find((card) => card.code === maharaghiCode && card.location === "deck");
    const firstDraw = session.state.cards.find((card) => card.code === firstDrawCode);
    const secondDraw = session.state.cards.find((card) => card.code === secondDrawCode);
    expect(maharaghi).toBeDefined();
    expect(firstDraw).toBeDefined();
    expect(secondDraw).toBeDefined();
    moveDuelCard(session.state, maharaghi!.uid, "hand", 0);
    firstDraw!.sequence = 0;
    secondDraw!.sequence = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maharaghiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredSummonWindow, 0)).toEqual(getDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === maharaghi!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 0)).toEqual(getDuelLegalActions(restoredTriggerWindow.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === maharaghi!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    const restoredRegistrationChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), workspace, reader);
    expect(restoredRegistrationChain.restoreComplete, restoredRegistrationChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRegistrationChain.missingRegistryKeys).toEqual([]);
    drainRestoredChain(restoredRegistrationChain);
    expect(restoredRegistrationChain.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: maharaghi!.uid, event: "continuous", code: 1113, controller: 0 })]),
    );

    endTurn(restoredRegistrationChain.session, 0);
    expect(restoredRegistrationChain.session.state.turnPlayer).toBe(1);
    expect(restoredRegistrationChain.host.messages).not.toContain(`confirmed 0: ${firstDrawCode}`);

    endTurn(restoredRegistrationChain.session, 1);

    expect(restoredRegistrationChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "confirmed", eventCode: 1211, eventPlayer: 0, eventUids: [firstDraw!.uid] })]),
    );
    expect(restoredRegistrationChain.session.state.cards.find((card) => card.uid === firstDraw!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredRegistrationChain.session.state.cards.find((card) => card.uid === secondDraw!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredRegistrationChain.session.state.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: maharaghi!.uid, event: "continuous", code: 1113, controller: 0 })]),
    );
  });
});

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function endTurn(session: DuelSession, player: 0 | 1): void {
  const action = getDuelLegalActions(session, player).find((candidate) => candidate.type === "endTurn");
  expect(action, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
