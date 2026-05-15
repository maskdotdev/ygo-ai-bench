import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script turn player phase conditions", () => {
  it("restores exact phase checks paired with self and opponent turn-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const battleManiaCode = "31245780";
    const elephunCode = "76848240";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === battleManiaCode || card.code === elephunCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [battleManiaCode, elephunCode] }, 1: { main: [] } });
    startDuel(session);

    const battleMania = session.state.cards.find((card) => card.code === battleManiaCode);
    const elephun = session.state.cards.find((card) => card.code === elephunCode);
    expect(battleMania).toBeDefined();
    expect(elephun).toBeDefined();
    moveDuelCard(session.state, battleMania!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, elephun!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [battleManiaCode, elephunCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:turn-player-phase:opponent:2", sourceUid: battleMania!.uid }),
        expect.objectContaining({ luaConditionDescriptor: "condition:turn-player-phase:self:2", sourceUid: elephun!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredBattleMania = restored.session.state.cards.find((card) => card.code === battleManiaCode);
    const restoredElephun = restored.session.state.cards.find((card) => card.code === elephunCode);
    const opponentStandbyEffect = restored.session.state.effects.find((effect) => effect.sourceUid === battleMania!.uid && effect.luaConditionDescriptor === "condition:turn-player-phase:opponent:2");
    const selfStandbyEffect = restored.session.state.effects.find((effect) => effect.sourceUid === elephun!.uid && effect.luaConditionDescriptor === "condition:turn-player-phase:self:2");
    expect(opponentStandbyEffect?.canActivate).toBeDefined();
    expect(selfStandbyEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "standby";
    restored.session.state.turnPlayer = 0;
    expect(opponentStandbyEffect!.canActivate!(targetContext(restored.session.state, restoredBattleMania!))).toBe(false);
    expect(selfStandbyEffect!.canActivate!(targetContext(restored.session.state, restoredElephun!))).toBe(true);
    restored.session.state.turnPlayer = 1;
    expect(opponentStandbyEffect!.canActivate!(targetContext(restored.session.state, restoredBattleMania!))).toBe(true);
    expect(selfStandbyEffect!.canActivate!(targetContext(restored.session.state, restoredElephun!))).toBe(false);
    restored.session.state.phase = "main1";
    expect(opponentStandbyEffect!.canActivate!(targetContext(restored.session.state, restoredBattleMania!))).toBe(false);
  });
});
