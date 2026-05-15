import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Alien Psychic counter attack lock", () => {
  it("restores its summon position trigger and A-counter attack announcement restriction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const alienPsychicCode = "58012107";
    const counteredAttackerCode = "58012108";
    const openAttackerCode = "58012109";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === alienPsychicCode),
      { code: counteredAttackerCode, name: "Alien Psychic A-Counter Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: openAttackerCode, name: "Alien Psychic Open Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5801, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alienPsychicCode] }, 1: { main: [counteredAttackerCode, openAttackerCode] } });
    startDuel(session);

    const alienPsychic = session.state.cards.find((card) => card.code === alienPsychicCode);
    const counteredAttacker = session.state.cards.find((card) => card.code === counteredAttackerCode);
    const openAttacker = session.state.cards.find((card) => card.code === openAttackerCode);
    expect(alienPsychic).toBeDefined();
    expect(counteredAttacker).toBeDefined();
    expect(openAttacker).toBeDefined();
    moveDuelCard(session.state, alienPsychic!.uid, "hand", 0);
    moveDuelCard(session.state, counteredAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, openAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    expect(addDuelCardCounter(counteredAttacker, counterA, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alienPsychicCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === alienPsychic!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === alienPsychic!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === alienPsychic!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpDefense",
    });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === alienPsychic!.uid)).toHaveLength(1);

    restoredTriggerWindow.session.state.turnPlayer = 1;
    restoredTriggerWindow.session.state.phase = "battle";
    restoredTriggerWindow.session.state.waitingFor = 1;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 1).filter((action) => action.type === "declareAttack");
    expect(battleActions.some((action) => action.attackerUid === counteredAttacker!.uid)).toBe(false);
    expect(battleActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "declareAttack", attackerUid: openAttacker!.uid, targetUid: alienPsychic!.uid })]),
    );

    const probe = restoredBattle.host.loadScript(attackLockProbeScript(counteredAttackerCode, openAttackerCode), "alien-psychic-attack-lock-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredBattle.host.messages).toContain("alien psychic CanAttack false/true");
  });
});

function attackLockProbeScript(counteredAttackerCode: string, openAttackerCode: string): string {
  return `
    local countered=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${counteredAttackerCode}),1,LOCATION_MZONE,0,nil)
    local open=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${openAttackerCode}),1,LOCATION_MZONE,0,nil)
    Debug.Message("alien psychic CanAttack " .. tostring(countered and countered:CanAttack()) .. "/" .. tostring(open and open:CanAttack()))
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
