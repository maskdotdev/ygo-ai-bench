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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script original triple trait Lizard locks", () => {
  it("restores Crimson Gaia's original DARK Dragon Synchro Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gaiaCode = "66141736";
    const darkDragonSynchroCode = "66141737";
    const lightDragonSynchroCode = "66141738";
    const darkFiendSynchroCode = "66141739";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gaiaCode),
      { code: darkDragonSynchroCode, name: "Original DARK Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: lightDragonSynchroCode, name: "Original LIGHT Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: darkFiendSynchroCode, name: "Original DARK Fiend Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 661, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gaiaCode], extra: [darkDragonSynchroCode, lightDragonSynchroCode, darkFiendSynchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaiaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gaiaCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${gaiaCode}.lizfilter)
      `,
      "crimson-gaia-official-original-type-attribute-race-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-attribute-race:8192:32:8192",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const mutate = restored.host.loadScript(
      `
      local dark_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fiend=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFiendSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_change=Effect.CreateEffect(dark_dragon)
      light_change:SetType(EFFECT_TYPE_SINGLE)
      light_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      light_change:SetValue(ATTRIBUTE_LIGHT)
      dark_dragon:RegisterEffect(light_change)
      local dark_change=Effect.CreateEffect(light_dragon)
      dark_change:SetType(EFFECT_TYPE_SINGLE)
      dark_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      dark_change:SetValue(ATTRIBUTE_DARK)
      light_dragon:RegisterEffect(dark_change)
      local dragon_change=Effect.CreateEffect(dark_fiend)
      dragon_change:SetType(EFFECT_TYPE_SINGLE)
      dragon_change:SetCode(EFFECT_CHANGE_RACE)
      dragon_change:SetValue(RACE_DRAGON)
      dark_fiend:RegisterEffect(dragon_change)
      `,
      "crimson-gaia-current-trait-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === gaiaCode);
    const darkDragonSynchro = restored.session.state.cards.find((card) => card.code === darkDragonSynchroCode);
    const lightDragonSynchro = restored.session.state.cards.find((card) => card.code === lightDragonSynchroCode);
    const darkFiendSynchro = restored.session.state.cards.find((card) => card.code === darkFiendSynchroCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(darkDragonSynchro).toBeDefined();
    expect(lightDragonSynchro).toBeDefined();
    expect(darkFiendSynchro).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, darkDragonSynchro!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, lightDragonSynchro!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, darkFiendSynchro!)).toBe(true);
  });
});
