import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const locationOnField = 0x0c;

function conditionContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller opponent previous location condition", () => {
  it("restores opponent previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const veidosCode = "78783557";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === veidosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7878, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [veidosCode] }, 1: { main: [] } });
    startDuel(session);

    const veidos = session.state.cards.find((card) => card.code === veidosCode);
    expect(veidos).toBeDefined();
    moveDuelCard(session.state, veidos!.uid, "monsterZone", 1);
    moveDuelCard(session.state, veidos!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(veidosCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-controller-side-previous-location:${locationOnField}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: veidos!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredVeidos = restored.session.state.cards.find((card) => card.code === veidosCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === veidos!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredVeidos!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredVeidos!.previousController = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredVeidos!.previousController = 1;
    restoredVeidos!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
