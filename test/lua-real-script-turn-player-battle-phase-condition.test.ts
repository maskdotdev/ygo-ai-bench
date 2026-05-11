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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script turn player battle phase conditions", () => {
  it("restores self and opponent turn-player battle phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hiFiveCode = "91677585";
    const terraFirmaGravityCode = "26509612";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hiFiveCode || card.code === terraFirmaGravityCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hiFiveCode, terraFirmaGravityCode] }, 1: { main: [] } });
    startDuel(session);

    const hiFive = session.state.cards.find((card) => card.code === hiFiveCode);
    const terraFirmaGravity = session.state.cards.find((card) => card.code === terraFirmaGravityCode);
    expect(hiFive).toBeDefined();
    expect(terraFirmaGravity).toBeDefined();
    moveDuelCard(session.state, hiFive!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, terraFirmaGravity!.uid, "spellTrapZone", 0).sequence = 1;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [hiFiveCode, terraFirmaGravityCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:turn-player:self-battle-phase", sourceUid: hiFive!.uid }),
        expect.objectContaining({ luaConditionDescriptor: "condition:turn-player:opponent-battle-phase", sourceUid: terraFirmaGravity!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredHiFive = restored.session.state.cards.find((card) => card.code === hiFiveCode);
    const restoredTerraFirmaGravity = restored.session.state.cards.find((card) => card.code === terraFirmaGravityCode);
    const selfBattleEffect = restored.session.state.effects.find((effect) => effect.sourceUid === hiFive!.uid && effect.luaConditionDescriptor === "condition:turn-player:self-battle-phase");
    const opponentBattleEffect = restored.session.state.effects.find((effect) => effect.sourceUid === terraFirmaGravity!.uid && effect.luaConditionDescriptor === "condition:turn-player:opponent-battle-phase");
    expect(selfBattleEffect?.canActivate).toBeDefined();
    expect(opponentBattleEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "battle";
    restored.session.state.turnPlayer = 0;
    expect(selfBattleEffect!.canActivate!(targetContext(restored.session.state, restoredHiFive!))).toBe(true);
    expect(opponentBattleEffect!.canActivate!(targetContext(restored.session.state, restoredTerraFirmaGravity!))).toBe(false);
    restored.session.state.turnPlayer = 1;
    expect(selfBattleEffect!.canActivate!(targetContext(restored.session.state, restoredHiFive!))).toBe(false);
    expect(opponentBattleEffect!.canActivate!(targetContext(restored.session.state, restoredTerraFirmaGravity!))).toBe(true);
    restored.session.state.phase = "main1";
    expect(opponentBattleEffect!.canActivate!(targetContext(restored.session.state, restoredTerraFirmaGravity!))).toBe(false);
  });
});
