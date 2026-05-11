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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script damage source relate battle target condition", () => {
  it("restores damage-step source relate-to-battle target checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const roboyarouCode = "1412158";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [roboyarouCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8224, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode], extra: [roboyarouCode] }, 1: { main: [] } });
    startDuel(session);

    const roboyarou = session.state.cards.find((card) => card.code === roboyarouCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(roboyarou).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, roboyarou!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(roboyarouCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:damage-source-relate-battle-target",
          sourceUid: roboyarou!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredRoboyarou = restored.session.state.cards.find((card) => card.code === roboyarouCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === roboyarou!.uid && candidate.luaConditionDescriptor === "condition:damage-source-relate-battle-target");
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredRoboyarou!);
    restored.session.state.phase = "battle";
    restored.session.state.currentAttack = { attackerUid: restoredRoboyarou!.uid, targetUid: restoredTarget!.uid };
    restored.session.state.battleStep = "attack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.battleStep = "damage";
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.battleStep = "damageCalculation";
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredRoboyarou!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
