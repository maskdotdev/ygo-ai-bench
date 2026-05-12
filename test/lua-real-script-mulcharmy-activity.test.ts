import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelActivity } from "#duel/activity.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mulcharmy activity counters", () => {
  it("counts real Mulcharmy monster effect chain activations for the shared two-activation limit", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fuwalosCode = "42141493";
    const puruliaCode = "84192580";
    const meowlsCode = "87126721";
    const codes = [fuwalosCode, puruliaCode, meowlsCode];
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => codes.includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 292, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: codes }, 1: { main: [] } });
    startDuel(session);

    for (const code of codes) {
      const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === "deck");
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }

    const host = createLuaScriptHost(session, workspace);
    for (const code of codes) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activateByCode = (code: string) => {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === card?.uid);
      expect(action).toBeDefined();
      const result = applyResponse(session, action!);
      expect(result.ok, result.error).toBe(true);
      return card;
    };

    const fuwalos = activateByCode(fuwalosCode);
    expect(fuwalos).toMatchObject({ location: "graveyard" });

    const restoredAfterFuwalos = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredAfterFuwalos.restoreComplete, restoredAfterFuwalos.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterFuwalos.session.state.activityHistory.filter((record) => record.activity === duelActivity.chain && record.player === 0)).toHaveLength(1);

    const purulia = restoredAfterFuwalos.session.state.cards.find((candidate) => candidate.code === puruliaCode);
    const puruliaAction = getLuaRestoreLegalActions(restoredAfterFuwalos, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === purulia?.uid);
    expect(puruliaAction).toBeDefined();
    const puruliaResult = applyLuaRestoreResponse(restoredAfterFuwalos, puruliaAction!);
    expect(puruliaResult.ok, puruliaResult.error).toBe(true);
    expect(purulia).toMatchObject({ location: "graveyard" });

    const meowls = restoredAfterFuwalos.session.state.cards.find((card) => card.code === meowlsCode);
    expect(getLuaRestoreLegalActions(restoredAfterFuwalos, 0).some((action) => action.type === "activateEffect" && action.uid === meowls?.uid)).toBe(false);
    const chainActivity = restoredAfterFuwalos.session.state.activityHistory.filter((record) => record.activity === duelActivity.chain && record.player === 0);
    expect(chainActivity).toHaveLength(2);
    expect(chainActivity.every((record) => record.effectId?.startsWith("lua-"))).toBe(true);
  });
});
