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
const statusOpposingBattle = 0x10000000;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source status battle target control condition", () => {
  it("restores source IsStatus plus battle target control checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sarcoughagusCode = "30037118";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [sarcoughagusCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8117, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sarcoughagusCode] }, 1: { extra: [targetCode], main: [] } });
    startDuel(session);

    const sarcoughagus = session.state.cards.find((card) => card.code === sarcoughagusCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(sarcoughagus).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, sarcoughagus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.controller = 1;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(sarcoughagusCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status-battle-target-control:${statusOpposingBattle}`,
          sourceUid: sarcoughagus!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredSarcoughagus = restored.session.state.cards.find((card) => card.code === sarcoughagusCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === sarcoughagus!.uid && candidate.luaConditionDescriptor === `condition:source-status-battle-target-control:${statusOpposingBattle}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSarcoughagus!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredSarcoughagus!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredTarget!.uid, targetUid: restoredSarcoughagus!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.location = "graveyard";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
