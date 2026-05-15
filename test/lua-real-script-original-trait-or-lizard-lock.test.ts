import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script original trait OR Clock Lizard lock", () => {
  it("restores equivalent not-type-or-not-attribute original trait checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "9396662";
    const waterSynchroCode = "9396663";
    const fireSynchroCode = "9396664";
    const waterFusionCode = "9396665";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: waterSynchroCode, name: "Original WATER Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x2, level: 6, attack: 1000, defense: 1000 },
      { code: fireSynchroCode, name: "Original FIRE Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x4, level: 6, attack: 1000, defense: 1000 },
      { code: waterFusionCode, name: "Original WATER Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x2, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 939, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode], extra: [waterSynchroCode, fireSynchroCode, waterFusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return not c:IsOriginalType(TYPE_SYNCHRO) or not c:IsOriginalAttribute(ATTRIBUTE_WATER) end)
      `,
      "original-trait-or-official-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-attribute:8192:2",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === sourceCode);
    const waterSynchro = restored.session.state.cards.find((card) => card.code === waterSynchroCode);
    const fireSynchro = restored.session.state.cards.find((card) => card.code === fireSynchroCode);
    const waterFusion = restored.session.state.cards.find((card) => card.code === waterFusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(waterSynchro).toBeDefined();
    expect(fireSynchro).toBeDefined();
    expect(waterFusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, waterSynchro!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, fireSynchro!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, waterFusion!)).toBe(true);
  });
});
