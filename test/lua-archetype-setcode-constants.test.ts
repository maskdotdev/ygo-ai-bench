import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua archetype setcode constants", () => {
  it("keeps real Project Ignis archetype filters legal when cards use archetype_setcode_constants.lua names", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === "56506740" || card.code === "63198739");
    const session = createDuel({ seed: 288, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["56506740", "63198739"] }, 1: { main: [] } });
    startDuel(session);
    const lordlyLode = session.state.cards.find((card) => card.code === "56506740" && card.location === "deck");
    expect(lordlyLode).toBeDefined();
    moveDuelCard(session.state, lordlyLode!.uid, "hand", 0);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(56506740, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const search = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lordlyLode!.uid);
    expect(search).toBeDefined();
    const result = applyResponse(session, search!);
    expect(result.ok, result.error).toBe(true);
    expect(session.state.cards.find((card) => card.code === "63198739")).toMatchObject({ location: "hand" });
  });
});
