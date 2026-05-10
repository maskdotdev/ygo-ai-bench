import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ash Blossom & Joyous Spring", () => {
  it("restores its hand response to a Deck search and suppresses the negated operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wantedCode = "80845034";
    const diabellstarCode = "72270339";
    const ashBlossomCode = "14558127";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [wantedCode, diabellstarCode, ashBlossomCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 145, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wantedCode, diabellstarCode] }, 1: { main: [ashBlossomCode] } });
    startDuel(session);

    const wanted = session.state.cards.find((card) => card.code === wantedCode);
    const diabellstar = session.state.cards.find((card) => card.code === diabellstarCode);
    const ashBlossom = session.state.cards.find((card) => card.code === ashBlossomCode);
    expect(wanted).toBeDefined();
    expect(diabellstar).toBeDefined();
    expect(ashBlossom).toBeDefined();
    moveDuelCard(session.state, wanted!.uid, "hand", 0);
    moveDuelCard(session.state, ashBlossom!.uid, "hand", 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wantedCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(ashBlossomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const wantedAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === wanted!.uid);
    expect(wantedAction).toBeDefined();
    const opened = applyResponse(session, wantedAction!);
    expect(opened.ok, opened.error).toBe(true);
    expect(session.state.chain[0]?.operationInfos).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 0x8, player: 0, parameter: 0x11 })]),
    );

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredOpen.restoreComplete, restoredOpen.incompleteReasons.join("; ")).toBe(true);
    const ashResponse = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === ashBlossom!.uid);
    expect(ashResponse).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpen, ashResponse!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ashBlossom!.uid)).toMatchObject({ location: "graveyard" });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    const responsePlayer = restoredChain.session.state.waitingFor;
    expect(responsePlayer).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restoredChain, responsePlayer!)).toEqual(getGroupedDuelLegalActions(restoredChain.session, responsePlayer!));
    resolveOpenChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === ashBlossom!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === wanted!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === diabellstar!.uid)).toMatchObject({ location: "deck" });
    expect(restoredChain.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "chainDisabled" })]));
  });
});

function resolveOpenChain(restored: LuaSnapshotRestoreResult): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}
