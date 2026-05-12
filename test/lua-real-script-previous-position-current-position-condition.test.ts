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
const positionAttack = 0x3;
const positionDefense = 0x0c;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous position current position condition", () => {
  it("restores previous-position current-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const taintedWisdomCode = "28725004";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === taintedWisdomCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [taintedWisdomCode] }, 1: { main: [] } });
    startDuel(session);

    const taintedWisdom = session.state.cards.find((card) => card.code === taintedWisdomCode);
    expect(taintedWisdom).toBeDefined();
    moveDuelCard(session.state, taintedWisdom!.uid, "monsterZone", 0);
    taintedWisdom!.faceUp = true;
    taintedWisdom!.position = "faceUpAttack";
    taintedWisdom!.previousPosition = "faceUpAttack";
    taintedWisdom!.position = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(taintedWisdomCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-position-position:${positionAttack}:${positionDefense}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: taintedWisdom!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredTaintedWisdom = restored.session.state.cards.find((card) => card.code === taintedWisdomCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === taintedWisdom!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredTaintedWisdom!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTaintedWisdom!.position = "faceUpAttack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTaintedWisdom!.position = "faceUpDefense";
    restoredTaintedWisdom!.previousPosition = "faceUpDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
