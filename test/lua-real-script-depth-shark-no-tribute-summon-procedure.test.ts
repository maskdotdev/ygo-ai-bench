import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Depth Shark no-tribute summon procedure", () => {
  it("restores Depth Shark's no-tribute Lua summon procedure when the field is empty", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const depthSharkCode = "37798171";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === depthSharkCode),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 377, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [depthSharkCode] }, 1: { main: [] } });
    startDuel(session);

    const depthShark = requireCard(session, depthSharkCode);
    moveDuelCard(session.state, depthShark.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(depthSharkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "tributeSummon" && action.uid === depthShark.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    const summoned = applyLuaRestoreResponse(restored, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === depthShark.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
      summonMaterialUids: [],
    });
    expect(restored.session.state.players[0].normalSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "normalSummoned", eventCardUid: depthShark.uid }),
    ]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
