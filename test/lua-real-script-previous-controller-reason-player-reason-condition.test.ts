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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller reason player reason condition", () => {
  it("restores destroyed-by-opponent previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const messengelatoCode = "52404456";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === messengelatoCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5240, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [messengelatoCode] }, 1: { main: [] } });
    startDuel(session);

    const messengelato = session.state.cards.find((card) => card.code === messengelatoCode);
    expect(messengelato).toBeDefined();
    moveDuelCard(session.state, messengelato!.uid, "monsterZone", 0);
    moveDuelCard(session.state, messengelato!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(messengelatoCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: messengelato!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredMessengelato = restored.session.state.cards.find((card) => card.code === messengelatoCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === messengelato!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredMessengelato!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMessengelato!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMessengelato!.reasonPlayer = 1;
    restoredMessengelato!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMessengelato!.previousController = 0;
    restoredMessengelato!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
