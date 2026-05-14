import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script attribute-first original Type and Attribute Clock Lizard lock", () => {
  it("restores original DARK Synchro Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "19434243";
    const darkSynchroCode = "19434244";
    const lightSynchroCode = "19434245";
    const darkFusionCode = "19434246";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: darkSynchroCode, name: "Original DARK Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: lightSynchroCode, name: "Original LIGHT Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
      { code: darkFusionCode, name: "Original DARK Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 194, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode], extra: [darkSynchroCode, lightSynchroCode, darkFusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not (c:IsOriginalAttribute(ATTRIBUTE_DARK) and c:IsOriginalType(TYPE_SYNCHRO)) end)
      `,
      "original-attribute-type-official-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-attribute:8192:32",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === sourceCode);
    const darkSynchro = restored.session.state.cards.find((card) => card.code === darkSynchroCode);
    const lightSynchro = restored.session.state.cards.find((card) => card.code === lightSynchroCode);
    const darkFusion = restored.session.state.cards.find((card) => card.code === darkFusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(darkSynchro).toBeDefined();
    expect(lightSynchro).toBeDefined();
    expect(darkFusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, darkSynchro!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, lightSynchro!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, darkFusion!)).toBe(true);
  });
});
