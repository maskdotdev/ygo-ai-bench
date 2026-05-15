import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setConstellar = 0x53;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Constellar Leonis extra summon count", () => {
  it("restores Leonis's extra Constellar Normal Summon after the regular summon is spent", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const leonisCode = "17129783";
    const firstSummonCode = "17129784";
    const extraSummonCode = "17129785";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === leonisCode),
      { code: firstSummonCode, name: "Constellar First Summon", kind: "monster", typeFlags: 0x1, setcodes: [setConstellar], level: 4, attack: 1200, defense: 1000 },
      { code: extraSummonCode, name: "Constellar Extra Summon", kind: "monster", typeFlags: 0x1, setcodes: [setConstellar], level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [leonisCode, firstSummonCode, extraSummonCode] }, 1: { main: [] } });
    startDuel(session);

    const leonis = requireCard(session, leonisCode);
    const firstSummon = requireCard(session, firstSummonCode);
    const extraSummon = requireCard(session, extraSummonCode);
    moveDuelCard(session.state, leonis.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstSummon.uid, "hand", 0);
    moveDuelCard(session.state, extraSummon.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leonisCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const regularSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === firstSummon.uid);
    expect(regularSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, regularSummon!);
    expect(session.state.players[0].normalSummonAvailable).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const extraAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === extraSummon.uid);
    expect(extraAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, extraAction!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === extraSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
    });
    expect(restored.session.state.activityCounts[0].normalSummon).toBe(2);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "normalSummoned", eventCardUid: firstSummon.uid }),
      expect.objectContaining({ eventName: "normalSummoned", eventCardUid: extraSummon.uid }),
    ]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
