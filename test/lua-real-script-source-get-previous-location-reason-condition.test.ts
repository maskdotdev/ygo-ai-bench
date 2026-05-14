import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const locationOnField = 0x0c;

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetPreviousLocation reason condition", () => {
  it("restores GetPreviousLocation bitmask reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const infernityKnightCode = "71341529";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === infernityKnightCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7134, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [infernityKnightCode] }, 1: { main: [] } });
    startDuel(session);

    const infernityKnight = session.state.cards.find((card) => card.code === infernityKnightCode);
    expect(infernityKnight).toBeDefined();
    moveDuelCard(session.state, infernityKnight!.uid, "monsterZone", 0);
    moveDuelCard(session.state, infernityKnight!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(infernityKnightCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: infernityKnight!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredInfernityKnight = restored.session.state.cards.find((card) => card.code === infernityKnightCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === infernityKnight!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredInfernityKnight!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredInfernityKnight!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredInfernityKnight!.reason = duelReason.destroy;
    restoredInfernityKnight!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
