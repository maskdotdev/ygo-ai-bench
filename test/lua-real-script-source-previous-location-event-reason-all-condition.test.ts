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
const discardEffectReason = duelReason.discard | duelReason.effect;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location event reason-all condition", () => {
  it("restores GetPreviousLocation event reason-all checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kahkkiCode = "25847467";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kahkkiCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2584, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kahkkiCode] }, 1: { main: [] } });
    startDuel(session);

    const kahkki = session.state.cards.find((card) => card.code === kahkkiCode);
    expect(kahkki).toBeDefined();
    moveDuelCard(session.state, kahkki!.uid, "hand", 0);
    moveDuelCard(session.state, kahkki!.uid, "graveyard", 0, discardEffectReason, 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(kahkkiCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-location-reason-all:${locationHand}:${discardEffectReason}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: kahkki!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredKahkki = restored.session.state.cards.find((card) => card.code === kahkkiCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === kahkki!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredKahkki!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredKahkki!.reason = duelReason.discard;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: discardEffectReason })).toBe(true);
    restoredKahkki!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredKahkki!.reason = discardEffectReason;
    restoredKahkki!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
