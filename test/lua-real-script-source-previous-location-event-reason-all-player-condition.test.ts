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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location event reason-all player condition", () => {
  it("restores opponent-caused GetPreviousLocation event reason-all checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const minarCode = "32539892";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === minarCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3253, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [minarCode] }, 1: { main: [] } });
    startDuel(session);

    const minar = session.state.cards.find((card) => card.code === minarCode);
    expect(minar).toBeDefined();
    moveDuelCard(session.state, minar!.uid, "hand", 0);
    moveDuelCard(session.state, minar!.uid, "graveyard", 0, discardEffectReason, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(minarCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-location-reason-all-player:${locationHand}:${discardEffectReason}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: minar!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredMinar = restored.session.state.cards.find((card) => card.code === minarCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === minar!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredMinar!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMinar!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    restoredMinar!.reasonPlayer = 1;
    restoredMinar!.reason = duelReason.discard;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: discardEffectReason })).toBe(true);
    restoredMinar!.reason = discardEffectReason;
    restoredMinar!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
