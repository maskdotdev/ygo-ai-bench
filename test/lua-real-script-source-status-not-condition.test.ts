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
const statusBattleDestroyed = 0x4000;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source negated status condition", () => {
  it("restores source not IsStatus checks from serialized battle status", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vennominagaCode = "8062132";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vennominagaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7429, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vennominagaCode] }, 1: { main: [] } });
    startDuel(session);

    const vennominaga = session.state.cards.find((card) => card.code === vennominagaCode);
    expect(vennominaga).toBeDefined();
    moveDuelCard(session.state, vennominaga!.uid, "monsterZone", 0);
    vennominaga!.faceUp = true;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(vennominagaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status-not:${statusBattleDestroyed}`,
          sourceUid: vennominaga!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredVennominaga = restored.session.state.cards.find((card) => card.code === vennominagaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === vennominaga!.uid && candidate.luaConditionDescriptor === `condition:source-status-not:${statusBattleDestroyed}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredVennominaga!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredVennominaga!.customStatusMask = statusBattleDestroyed;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredVennominaga!.customStatusMask = 0;
    restoredVennominaga!.reason = duelReason.battle;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
