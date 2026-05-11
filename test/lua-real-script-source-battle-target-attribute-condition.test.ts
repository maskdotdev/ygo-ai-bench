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
const attributeLight = 0x10;
const attributeDark = 0x20;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source battle target attribute condition", () => {
  it("restores source battle-target attribute checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const brainGolemCode = "17313545";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [brainGolemCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brainGolemCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const brainGolem = session.state.cards.find((card) => card.code === brainGolemCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(brainGolem).toBeDefined();
    expect(target).toBeDefined();
    target!.data.attribute = attributeLight;
    moveDuelCard(session.state, brainGolem!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(brainGolemCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-battle-target-attribute:${attributeLight}`,
          sourceUid: brainGolem!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredBrainGolem = restored.session.state.cards.find((card) => card.code === brainGolemCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === brainGolem!.uid && candidate.luaConditionDescriptor === `condition:source-battle-target-attribute:${attributeLight}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredBrainGolem!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBrainGolem!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.attribute = attributeDark;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBrainGolem!.uid };
    restoredTarget!.data.attribute = attributeLight;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
