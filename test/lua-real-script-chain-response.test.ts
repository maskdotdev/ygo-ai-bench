import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script chain responses", () => {
  it("lets Ghost Belle negate WANTED by reading live chain operation info", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wantedCode = "80845034";
    const diabellstarCode = "72270339";
    const ghostBelleCode = "73642296";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [wantedCode, diabellstarCode, ghostBelleCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 289, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wantedCode, diabellstarCode] }, 1: { main: [ghostBelleCode] } });
    startDuel(session);

    const wanted = session.state.cards.find((card) => card.code === wantedCode && card.controller === 0 && card.location === "deck");
    const ghostBelle = session.state.cards.find((card) => card.code === ghostBelleCode && card.controller === 1 && card.location === "deck");
    const diabellstar = session.state.cards.find((card) => card.code === diabellstarCode && card.controller === 0 && card.location === "deck");
    expect(wanted).toBeDefined();
    expect(ghostBelle).toBeDefined();
    expect(diabellstar).toBeDefined();
    moveDuelCard(session.state, wanted!.uid, "hand", 0);
    moveDuelCard(session.state, ghostBelle!.uid, "hand", 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wantedCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(ghostBelleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const wantedAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === wanted!.uid);
    expect(wantedAction).toBeDefined();
    const opened = applyResponse(session, wantedAction!);
    expect(opened.ok, opened.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const ghostBelleAction = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid === ghostBelle!.uid);
    expect(ghostBelleAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restored, ghostBelleAction!);
    expect(chained.ok, chained.error).toBe(true);

    for (let index = 0; index < 4 && restored.session.state.chain.length > 0; index += 1) {
      const passPlayer = restored.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restored, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restored, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }
    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === ghostBelle!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === diabellstar!.uid)).toMatchObject({ location: "deck" });
  });
});
