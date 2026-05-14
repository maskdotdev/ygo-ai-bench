import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense, currentLevel } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Emissary SelectTribute summon procedure", () => {
  it("restores Emissary's one-tribute Lua summon procedure and stat rewrite", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const emissaryCode = "42685062";
    const tributeCode = "42685063";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === emissaryCode),
      { code: tributeCode, name: "Emissary Tribute Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 426, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [emissaryCode, tributeCode] }, 1: { main: [] } });
    startDuel(session);

    const emissary = requireCard(session, emissaryCode);
    const tribute = requireCard(session, tributeCode);
    moveDuelCard(session.state, emissary.uid, "hand", 0);
    moveDuelCard(session.state, tribute.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(emissaryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "tributeSummon" && action.uid === emissary.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    const summoned = applyLuaRestoreResponse(restored, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    const restoredEmissary = restored.session.state.cards.find((card) => card.uid === emissary.uid);
    expect(restoredEmissary).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "tribute",
      summonMaterialUids: [tribute.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      reason: 0x1a,
    });
    expect(currentLevel(restoredEmissary, restored.session.state)).toBe(5);
    expect(currentAttack(restoredEmissary, restored.session.state)).toBe(1300);
    expect(currentDefense(restoredEmissary, restored.session.state)).toBe(900);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "released", eventCardUid: tribute.uid }),
      expect.objectContaining({ eventName: "normalSummoned", eventCardUid: emissary.uid }),
    ]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
