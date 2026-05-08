import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script summon procedures", () => {
  it("special summons Diabellstar by procedure and resolves its set trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const diabellstarCode = "72270339";
    const fodderCode = "73642296";
    const wantedCode = "80845034";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [diabellstarCode, fodderCode, wantedCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 291, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [diabellstarCode, fodderCode, wantedCode] }, 1: { main: [] } });
    startDuel(session);

    const diabellstar = session.state.cards.find((card) => card.code === diabellstarCode && card.location === "deck");
    const fodder = session.state.cards.find((card) => card.code === fodderCode && card.location === "deck");
    const wanted = session.state.cards.find((card) => card.code === wantedCode && card.location === "deck");
    expect(diabellstar).toBeDefined();
    expect(fodder).toBeDefined();
    expect(wanted).toBeDefined();
    moveDuelCard(session.state, diabellstar!.uid, "hand", 0);
    moveDuelCard(session.state, fodder!.uid, "hand", 0);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(diabellstarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === diabellstar!.uid);
    expect(procedure).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, procedure!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === diabellstar!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === fodder!.uid)).toMatchObject({ location: "graveyard" });

    const setTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === diabellstar!.uid);
    expect(setTrigger).toBeDefined();
    const set = applyLuaRestoreResponse(restored, setTrigger!);
    expect(set.ok, set.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === wanted!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false });
  });
});
