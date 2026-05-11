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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Scatter Fusion Clock Lizard setcode lock", () => {
  it("restores its current Gem-Knight Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const scatterFusionCode = "40597694";
    const gemKnightCode = "40597695";
    const offSetCode = "40597696";
    const setGemKnight = 0x1047;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === scatterFusionCode),
      { code: gemKnightCode, name: "Scatter Fusion Gem-Knight Probe", kind: "extra", typeFlags: 0x41, setcodes: [setGemKnight], race: 0x20, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
      { code: offSetCode, name: "Scatter Fusion Off-Set Probe", kind: "extra", typeFlags: 0x41, setcodes: [0x123], race: 0x20, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 405, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scatterFusionCode], extra: [gemKnightCode, offSetCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scatterFusionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${scatterFusionCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return not c:IsSetCard(SET_GEM_KNIGHT) end)
      `,
      "scatter-fusion-official-current-setcode-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: `target:not-setcode:${setGemKnight}`,
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === scatterFusionCode);
    const gemKnight = restored.session.state.cards.find((card) => card.code === gemKnightCode);
    const offSet = restored.session.state.cards.find((card) => card.code === offSetCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(gemKnight).toBeDefined();
    expect(offSet).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, gemKnight!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, offSet!)).toBe(true);
  });
});
