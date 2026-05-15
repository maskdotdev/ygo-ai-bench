import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
    player: 0,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sunvine Shrine continuous Clock Lizard lock", () => {
  it("restores its Spell/Trap Zone original Plant Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shrineCode = "27946124";
    const plantCode = "27946125";
    const fiendCode = "27946126";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shrineCode),
      { code: plantCode, name: "Sunvine Shrine Original Plant Probe", kind: "extra", typeFlags: 0x41, race: 0x400, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
      { code: fiendCode, name: "Sunvine Shrine Original Fiend Probe", kind: "extra", typeFlags: 0x41, race: 0x8, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 279, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shrineCode], extra: [plantCode, fiendCode] }, 1: { main: [] } });
    startDuel(session);
    const shrine = session.state.cards.find((card) => card.code === shrineCode);
    expect(shrine).toBeDefined();
    moveDuelCard(session.state, shrine!.uid, "spellTrapZone", 0);
    shrine!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shrineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaTargetDescriptor: "target:not-original-race:1024",
      range: ["spellTrapZone"],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === shrineCode);
    const plant = restored.session.state.cards.find((card) => card.code === plantCode);
    const fiend = restored.session.state.cards.find((card) => card.code === fiendCode);
    expect(restoredEffect).toMatchObject({
      luaTargetDescriptor: "target:not-original-race:1024",
      range: ["spellTrapZone"],
      value: 1,
    });
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(plant).toBeDefined();
    expect(fiend).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(restoredEffect!.targetCardPredicate!(ctx, plant!)).toBe(false);
    expect(restoredEffect!.targetCardPredicate!(ctx, fiend!)).toBe(true);
  });
});
