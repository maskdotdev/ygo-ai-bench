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
const locationHand = 0x02;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location event reason condition", () => {
  it("restores GetPreviousLocation event-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ganashiaCode = "18282103";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ganashiaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1828, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ganashiaCode] }, 1: { main: [] } });
    startDuel(session);

    const ganashia = session.state.cards.find((card) => card.code === ganashiaCode);
    expect(ganashia).toBeDefined();
    moveDuelCard(session.state, ganashia!.uid, "hand", 0);
    moveDuelCard(session.state, ganashia!.uid, "graveyard", 0, duelReason.discard, 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(ganashiaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-location-reason:${locationHand}:${duelReason.discard}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: ganashia!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredGanashia = restored.session.state.cards.find((card) => card.code === ganashiaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === ganashia!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredGanashia!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredGanashia!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.discard })).toBe(true);
    restoredGanashia!.reason = duelReason.discard;
    restoredGanashia!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
