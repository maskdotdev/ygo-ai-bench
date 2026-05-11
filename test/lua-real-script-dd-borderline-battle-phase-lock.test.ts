import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D.D. Borderline battle phase lock", () => {
  it("hides and restores Battle Phase legal actions from official EFFECT_CANNOT_BP", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const borderlineCode = "60912752";
    const borderline = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === borderlineCode);
    expect(borderline).toBeDefined();
    const cards: DuelCardData[] = [
      borderline!,
      { code: "90000031", name: "Grave Spell", kind: "spell" },
      { code: "90000032", name: "Normal Monster", kind: "monster", level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 609, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [borderlineCode, "90000031", "90000032"] }, 1: { main: [] } });
    startDuel(session);

    const borderlineCard = session.state.cards.find((card) => card.code === borderlineCode);
    const graveSpell = session.state.cards.find((card) => card.code === "90000031");
    expect(borderlineCard).toBeDefined();
    expect(graveSpell).toBeDefined();
    moveDuelCard(session.state, borderlineCard!.uid, "spellTrapZone", 0);
    borderlineCard!.faceUp = true;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(borderlineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 185, sourceUid: borderlineCard!.uid, targetRange: [1, 1] })]));

    expect(getLegalActions(session, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    let restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));

    moveDuelCard(session.state, graveSpell!.uid, "graveyard", 0);
    expect(getLegalActions(session, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
  });
});
