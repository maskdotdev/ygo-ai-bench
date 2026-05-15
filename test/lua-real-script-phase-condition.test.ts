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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script phase-only conditions", () => {
  it("restores standalone battle phase and exact phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const damageJugglerCode = "68819554";
    const junkSleepCode = "56294501";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === damageJugglerCode || card.code === junkSleepCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [damageJugglerCode, junkSleepCode] }, 1: { main: [] } });
    startDuel(session);

    const damageJuggler = session.state.cards.find((card) => card.code === damageJugglerCode);
    const junkSleep = session.state.cards.find((card) => card.code === junkSleepCode);
    expect(damageJuggler).toBeDefined();
    expect(junkSleep).toBeDefined();
    moveDuelCard(session.state, damageJuggler!.uid, "hand", 0);
    moveDuelCard(session.state, junkSleep!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [damageJugglerCode, junkSleepCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:battle-phase", sourceUid: damageJuggler!.uid }),
        expect.objectContaining({ luaConditionDescriptor: "condition:phase:512", sourceUid: junkSleep!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredDamageJuggler = restored.session.state.cards.find((card) => card.code === damageJugglerCode);
    const restoredJunkSleep = restored.session.state.cards.find((card) => card.code === junkSleepCode);
    const battlePhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === damageJuggler!.uid && effect.luaConditionDescriptor === "condition:battle-phase");
    const endPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === junkSleep!.uid && effect.luaConditionDescriptor === "condition:phase:512");
    expect(battlePhaseEffect?.canActivate).toBeDefined();
    expect(endPhaseEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "battle";
    expect(battlePhaseEffect!.canActivate!(targetContext(restored.session.state, restoredDamageJuggler!))).toBe(true);
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(false);
    restored.session.state.phase = "end";
    expect(battlePhaseEffect!.canActivate!(targetContext(restored.session.state, restoredDamageJuggler!))).toBe(false);
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(true);
    restored.session.state.phase = "main1";
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(false);
  });
});
