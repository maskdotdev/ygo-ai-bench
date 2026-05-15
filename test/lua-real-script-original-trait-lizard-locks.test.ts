import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script original trait Lizard locks", () => {
  it("restores Blue-Eyes Roar's original Dragon Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const roarCode = "17725109";
    const dragonCode = "17725110";
    const spellcasterCode = "17725111";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === roarCode),
      { code: dragonCode, name: "Original Dragon Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: spellcasterCode, name: "Original Spellcaster Probe", kind: "extra", typeFlags: 0x41, race: 0x2, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 177, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [roarCode], extra: [dragonCode, spellcasterCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(roarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${roarCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not c:IsOriginalRace(RACE_DRAGON) end)
      `,
      "blue-eyes-roar-official-lizard-race.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-race:8192",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonCode}),0,LOCATION_EXTRA,0,nil)
      local spellcaster=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${spellcasterCode}),0,LOCATION_EXTRA,0,nil)
      local ed=Effect.CreateEffect(dragon)
      ed:SetType(EFFECT_TYPE_SINGLE)
      ed:SetCode(EFFECT_CHANGE_RACE)
      ed:SetValue(RACE_SPELLCASTER)
      dragon:RegisterEffect(ed)
      local es=Effect.CreateEffect(spellcaster)
      es:SetType(EFFECT_TYPE_SINGLE)
      es:SetCode(EFFECT_CHANGE_RACE)
      es:SetValue(RACE_DRAGON)
      spellcaster:RegisterEffect(es)
      `,
      "blue-eyes-roar-current-race-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === roarCode);
    const dragon = restored.session.state.cards.find((card) => card.code === dragonCode);
    const spellcaster = restored.session.state.cards.find((card) => card.code === spellcasterCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(dragon).toBeDefined();
    expect(spellcaster).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, dragon!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, spellcaster!)).toBe(true);
  });

  it("restores Rescue-ACE Quick Attacker's original FIRE Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "47425162";
    const fireCode = "47425163";
    const waterCode = "47425164";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === attackerCode),
      { code: fireCode, name: "Original FIRE Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x4, level: 8, attack: 1000, defense: 1000 },
      { code: waterCode, name: "Original WATER Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x2, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 474, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode], extra: [fireCode, waterCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(attackerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${attackerCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not c:IsOriginalAttribute(ATTRIBUTE_FIRE) end)
      `,
      "rescue-ace-quick-attacker-official-lizard-attribute.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-attribute:4",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local fire=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireCode}),0,LOCATION_EXTRA,0,nil)
      local water=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterCode}),0,LOCATION_EXTRA,0,nil)
      local ef=Effect.CreateEffect(fire)
      ef:SetType(EFFECT_TYPE_SINGLE)
      ef:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      ef:SetValue(ATTRIBUTE_WATER)
      fire:RegisterEffect(ef)
      local ew=Effect.CreateEffect(water)
      ew:SetType(EFFECT_TYPE_SINGLE)
      ew:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      ew:SetValue(ATTRIBUTE_FIRE)
      water:RegisterEffect(ew)
      `,
      "rescue-ace-quick-attacker-current-attribute-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === attackerCode);
    const fire = restored.session.state.cards.find((card) => card.code === fireCode);
    const water = restored.session.state.cards.find((card) => card.code === waterCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(fire).toBeDefined();
    expect(water).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, fire!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, water!)).toBe(true);
  });

  it("restores Crimson Gaia's original DARK Synchro Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gaiaCode = "62991792";
    const darkSynchroCode = "62991793";
    const lightSynchroCode = "62991794";
    const darkFusionCode = "62991795";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gaiaCode),
      { code: darkSynchroCode, name: "Original DARK Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: lightSynchroCode, name: "Original LIGHT Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: darkFusionCode, name: "Original DARK Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 629, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gaiaCode], extra: [darkSynchroCode, lightSynchroCode, darkFusionCode] }, 1: { main: [] } });
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
      "crimson-gaia-official-lizard-type-attribute.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-attribute:8192:32",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === gaiaCode);
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

  it("restores Ashened to Endlessness's original Machine Xyz Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ashenedCode = "38173725";
    const machineXyzCode = "38173726";
    const dragonXyzCode = "38173727";
    const machineSynchroCode = "38173728";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ashenedCode),
      { code: machineXyzCode, name: "Original Machine Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x20, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: dragonXyzCode, name: "Original Dragon Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: machineSynchroCode, name: "Original Machine Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x20, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 381, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ashenedCode], extra: [machineXyzCode, dragonXyzCode, machineSynchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashenedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ashenedCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${ashenedCode}.lizfilter)
      `,
      "ashened-to-endlessness-official-lizard-type-race.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-race:8388608:32",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === ashenedCode);
    const machineXyz = restored.session.state.cards.find((card) => card.code === machineXyzCode);
    const dragonXyz = restored.session.state.cards.find((card) => card.code === dragonXyzCode);
    const machineSynchro = restored.session.state.cards.find((card) => card.code === machineSynchroCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(machineXyz).toBeDefined();
    expect(dragonXyz).toBeDefined();
    expect(machineSynchro).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, machineXyz!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, dragonXyz!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, machineSynchro!)).toBe(true);
  });

  it("restores Ice Ryzeal's original Rank 4 Xyz Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const iceRyzealCode = "8633261";
    const rank4XyzCode = "8633262";
    const rank5XyzCode = "8633263";
    const level4SynchroCode = "8633264";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === iceRyzealCode),
      { code: rank4XyzCode, name: "Original Rank 4 Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x20, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: rank5XyzCode, name: "Original Rank 5 Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x20, attribute: 0x20, level: 5, attack: 1000, defense: 1000 },
      { code: level4SynchroCode, name: "Original Level 4 Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x20, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 863, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [iceRyzealCode], extra: [rank4XyzCode, rank5XyzCode, level4SynchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(iceRyzealCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${iceRyzealCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not (c:IsOriginalType(TYPE_XYZ) and c:IsOriginalRank(4)) end)
      `,
      "ice-ryzeal-official-lizard-type-rank.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-rank:8388608:4",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local rank4=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank4XyzCode}),0,LOCATION_EXTRA,0,nil)
      local rank5=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank5XyzCode}),0,LOCATION_EXTRA,0,nil)
      local e4=Effect.CreateEffect(rank4)
      e4:SetType(EFFECT_TYPE_SINGLE)
      e4:SetCode(EFFECT_CHANGE_RANK)
      e4:SetValue(5)
      rank4:RegisterEffect(e4)
      local e5=Effect.CreateEffect(rank5)
      e5:SetType(EFFECT_TYPE_SINGLE)
      e5:SetCode(EFFECT_CHANGE_RANK)
      e5:SetValue(4)
      rank5:RegisterEffect(e5)
      `,
      "ice-ryzeal-current-rank-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === iceRyzealCode);
    const rank4Xyz = restored.session.state.cards.find((card) => card.code === rank4XyzCode);
    const rank5Xyz = restored.session.state.cards.find((card) => card.code === rank5XyzCode);
    const level4Synchro = restored.session.state.cards.find((card) => card.code === level4SynchroCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(rank4Xyz).toBeDefined();
    expect(rank5Xyz).toBeDefined();
    expect(level4Synchro).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, rank4Xyz!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, rank5Xyz!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, level4Synchro!)).toBe(true);
  });

  it("restores Evil Assault's original HERO Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const evilAssaultCode = "3519195";
    const heroCode = "3519196";
    const nonHeroCode = "3519197";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === evilAssaultCode),
      { code: heroCode, name: "Original HERO Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x20, level: 8, attack: 1000, defense: 1000, setcodes: [0x8] },
      { code: nonHeroCode, name: "Original Non-HERO Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x20, level: 8, attack: 1000, defense: 1000, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 351, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [evilAssaultCode], extra: [heroCode, nonHeroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(evilAssaultCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${evilAssaultCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not c:IsOriginalSetCard(SET_HERO) end)
      `,
      "evil-assault-official-lizard-original-setcode.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-setcode:8",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local hero=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${heroCode}),0,LOCATION_EXTRA,0,nil)
      local nonhero=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nonHeroCode}),0,LOCATION_EXTRA,0,nil)
      local eh=Effect.CreateEffect(hero)
      eh:SetType(EFFECT_TYPE_SINGLE)
      eh:SetCode(EFFECT_CHANGE_SETCODE)
      eh:SetValue(0x123)
      hero:RegisterEffect(eh)
      local en=Effect.CreateEffect(nonhero)
      en:SetType(EFFECT_TYPE_SINGLE)
      en:SetCode(EFFECT_CHANGE_SETCODE)
      en:SetValue(SET_HERO)
      nonhero:RegisterEffect(en)
      `,
      "evil-assault-current-setcode-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === evilAssaultCode);
    const hero = restored.session.state.cards.find((card) => card.code === heroCode);
    const nonHero = restored.session.state.cards.find((card) => card.code === nonHeroCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(hero).toBeDefined();
    expect(nonHero).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, hero!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, nonHero!)).toBe(true);
  });

  it("restores multi-set original Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const windCode = "66384688";
    const majespecterCode = "66384689";
    const dracoslayerCode = "66384690";
    const otherCode = "66384691";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === windCode),
      { code: majespecterCode, name: "Original Majespecter Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x8, level: 8, attack: 1000, defense: 1000, setcodes: [0xd0] },
      { code: dracoslayerCode, name: "Original Dracoslayer Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x8, level: 8, attack: 1000, defense: 1000, setcodes: [0xc7] },
      { code: otherCode, name: "Original Other Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x8, level: 8, attack: 1000, defense: 1000, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 663, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [windCode], extra: [majespecterCode, dracoslayerCode, otherCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(windCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${windCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return not c:IsOriginalSetCard({SET_MAJESPECTER,SET_DRACOSLAYER}) end)
      `,
      "windwitch-chanbara-official-lizard-original-setcode-list.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-setcode-any:208,199",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === windCode);
    const majespecter = restored.session.state.cards.find((card) => card.code === majespecterCode);
    const dracoslayer = restored.session.state.cards.find((card) => card.code === dracoslayerCode);
    const other = restored.session.state.cards.find((card) => card.code === otherCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(majespecter).toBeDefined();
    expect(dracoslayer).toBeDefined();
    expect(other).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, majespecter!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, dracoslayer!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, other!)).toBe(true);
  });

  it("restores positive original DARK Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const talesCode = "4398189";
    const darkCode = "4398190";
    const lightCode = "4398191";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === talesCode),
      { code: darkCode, name: "Original DARK Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: lightCode, name: "Original LIGHT Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 439, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [talesCode], extra: [darkCode, lightCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(talesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${talesCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return c:IsOriginalAttribute(ATTRIBUTE_DARK) end)
      `,
      "tales-of-white-forest-official-positive-original-attribute.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:original-attribute:32",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkCode}),0,LOCATION_EXTRA,0,nil)
      local light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightCode}),0,LOCATION_EXTRA,0,nil)
      local ed=Effect.CreateEffect(dark)
      ed:SetType(EFFECT_TYPE_SINGLE)
      ed:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      ed:SetValue(ATTRIBUTE_LIGHT)
      dark:RegisterEffect(ed)
      local el=Effect.CreateEffect(light)
      el:SetType(EFFECT_TYPE_SINGLE)
      el:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      el:SetValue(ATTRIBUTE_DARK)
      light:RegisterEffect(el)
      `,
      "positive-original-attribute-current-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === talesCode);
    const dark = restored.session.state.cards.find((card) => card.code === darkCode);
    const light = restored.session.state.cards.find((card) => card.code === lightCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(dark).toBeDefined();
    expect(light).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, dark!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, light!)).toBe(false);
  });

  it("restores positive original setcode Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gullinCode = "7320132";
    const aesirCode = "7320133";
    const otherCode = "7320134";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gullinCode),
      { code: aesirCode, name: "Original Aesir Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x10, level: 8, attack: 1000, defense: 1000, setcodes: [0x4b] },
      { code: otherCode, name: "Original Non-Aesir Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x10, level: 8, attack: 1000, defense: 1000, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 732, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gullinCode], extra: [aesirCode, otherCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gullinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gullinCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return c:IsOriginalSetCard(SET_AESIR) end)
      `,
      "gullinbursti-official-positive-original-setcode.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:original-setcode:75",
      value: 1,
    });
  });

  it("restores positive original Link Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cynetCode = "86993168";
    const linkCode = "86993169";
    const synchroCode = "86993170";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cynetCode),
      { code: linkCode, name: "Original Link Probe", kind: "extra", typeFlags: 0x4000001, race: 0x1000000, attribute: 0x20, level: 2, attack: 1000, defense: 0 },
      { code: synchroCode, name: "Original Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x1000000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 869, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cynetCode], extra: [linkCode, synchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cynetCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${cynetCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(_,c) return c:IsOriginalType(TYPE_LINK) end)
      `,
      "cynet-mining-official-positive-original-type.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:original-type:67108864",
      value: 1,
    });
  });

  it("restores mixed original Synchro and current LIGHT/DARK Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lancerCode = "3806388";
    const lightSynchroCode = "3806389";
    const fireSynchroCode = "3806390";
    const darkFusionCode = "3806391";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lancerCode),
      { code: lightSynchroCode, name: "Original LIGHT Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: fireSynchroCode, name: "Original FIRE Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x4, level: 8, attack: 1000, defense: 1000 },
      { code: darkFusionCode, name: "Original DARK Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 380, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lancerCode], extra: [lightSynchroCode, fireSynchroCode, darkFusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lancerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lancerCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${lancerCode}.lizfilter)
      `,
      "chaos-lancer-official-mixed-original-current-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-current-attribute:8192:48",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local light_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local fire_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_change=Effect.CreateEffect(light_synchro)
      light_change:SetType(EFFECT_TYPE_SINGLE)
      light_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      light_change:SetValue(ATTRIBUTE_FIRE)
      light_synchro:RegisterEffect(light_change)
      local fire_change=Effect.CreateEffect(fire_synchro)
      fire_change:SetType(EFFECT_TYPE_SINGLE)
      fire_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      fire_change:SetValue(ATTRIBUTE_DARK)
      fire_synchro:RegisterEffect(fire_change)
      `,
      "chaos-lancer-current-attribute-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === lancerCode);
    const lightSynchro = restored.session.state.cards.find((card) => card.code === lightSynchroCode);
    const fireSynchro = restored.session.state.cards.find((card) => card.code === fireSynchroCode);
    const darkFusion = restored.session.state.cards.find((card) => card.code === darkFusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(lightSynchro).toBeDefined();
    expect(fireSynchro).toBeDefined();
    expect(darkFusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, lightSynchro!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, fireSynchro!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, darkFusion!)).toBe(true);
  });

  it("restores Destruction Swordsman's original Level and current Type Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const swordsmanCode = "73819701";
    const level8FusionCode = "73819702";
    const level7FusionCode = "73819703";
    const level8SynchroCode = "73819704";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === swordsmanCode),
      { code: level8FusionCode, name: "Original Level 8 Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: level7FusionCode, name: "Original Level 7 Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 7, attack: 1000, defense: 1000 },
      { code: level8SynchroCode, name: "Original Level 8 Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 738, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swordsmanCode], extra: [level8FusionCode, level7FusionCode, level8SynchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(swordsmanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${swordsmanCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not (c:IsOriginalLevel(8) and c:IsType(TYPE_FUSION|TYPE_SYNCHRO)) end)
      `,
      "destruction-swordsman-official-original-level-current-type-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-level-current-type:8:8256",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local level8_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level8SynchroCode}),0,LOCATION_EXTRA,0,nil)
      local type_change=Effect.CreateEffect(level8_synchro)
      type_change:SetType(EFFECT_TYPE_SINGLE)
      type_change:SetCode(EFFECT_CHANGE_TYPE)
      type_change:SetValue(TYPE_XYZ)
      level8_synchro:RegisterEffect(type_change)
      `,
      "destruction-swordsman-current-type-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === swordsmanCode);
    const level8Fusion = restored.session.state.cards.find((card) => card.code === level8FusionCode);
    const level7Fusion = restored.session.state.cards.find((card) => card.code === level7FusionCode);
    const level8Synchro = restored.session.state.cards.find((card) => card.code === level8SynchroCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(level8Fusion).toBeDefined();
    expect(level7Fusion).toBeDefined();
    expect(level8Synchro).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, level8Fusion!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, level7Fusion!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, level8Synchro!)).toBe(true);
  });

  it("restores original Type bitmask Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const overlayCode = "67378935";
    const xyzCode = "67378936";
    const fusionCode = "67378937";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === overlayCode),
      { code: xyzCode, name: "Original Xyz Bitmask Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Original Fusion Bitmask Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 673, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [overlayCode], extra: [xyzCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(overlayCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${overlayCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${overlayCode}.lizfilter)
      `,
      "overlay-network-official-original-type-bitmask-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type:8388608",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local xyz_change=Effect.CreateEffect(xyz)
      xyz_change:SetType(EFFECT_TYPE_SINGLE)
      xyz_change:SetCode(EFFECT_CHANGE_TYPE)
      xyz_change:SetValue(TYPE_FUSION)
      xyz:RegisterEffect(xyz_change)
      local fusion_change=Effect.CreateEffect(fusion)
      fusion_change:SetType(EFFECT_TYPE_SINGLE)
      fusion_change:SetCode(EFFECT_CHANGE_TYPE)
      fusion_change:SetValue(TYPE_XYZ)
      fusion:RegisterEffect(fusion_change)
      `,
      "overlay-network-current-type-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === overlayCode);
    const xyz = restored.session.state.cards.find((card) => card.code === xyzCode);
    const fusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(xyz).toBeDefined();
    expect(fusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, xyz!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, fusion!)).toBe(true);
  });

  it("restores original Level-above and Attribute Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dragonCode = "43722862";
    const level5WindCode = "43722863";
    const level4WindCode = "43722864";
    const level5DarkCode = "43722865";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonCode),
      { code: level5WindCode, name: "Original Level 5 WIND Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x8, level: 5, attack: 1000, defense: 1000 },
      { code: level4WindCode, name: "Original Level 4 WIND Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x8, level: 4, attack: 1000, defense: 1000 },
      { code: level5DarkCode, name: "Original Level 5 DARK Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 5, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 437, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonCode], extra: [level5WindCode, level4WindCode, level5DarkCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${dragonCode}.lizfilter)
      `,
      "speedroid-dominobutterfly-official-original-level-attribute-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-level-above-attribute:5:8",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const mutate = restored.host.loadScript(
      `
      local level5_wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5WindCode}),0,LOCATION_EXTRA,0,nil)
      local level4_wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level4WindCode}),0,LOCATION_EXTRA,0,nil)
      local level5_dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5DarkCode}),0,LOCATION_EXTRA,0,nil)
      local dark_change=Effect.CreateEffect(level5_wind)
      dark_change:SetType(EFFECT_TYPE_SINGLE)
      dark_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      dark_change:SetValue(ATTRIBUTE_DARK)
      level5_wind:RegisterEffect(dark_change)
      local level_change=Effect.CreateEffect(level4_wind)
      level_change:SetType(EFFECT_TYPE_SINGLE)
      level_change:SetCode(EFFECT_CHANGE_LEVEL)
      level_change:SetValue(5)
      level4_wind:RegisterEffect(level_change)
      local wind_change=Effect.CreateEffect(level5_dark)
      wind_change:SetType(EFFECT_TYPE_SINGLE)
      wind_change:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      wind_change:SetValue(ATTRIBUTE_WIND)
      level5_dark:RegisterEffect(wind_change)
      `,
      "speedroid-dominobutterfly-current-level-attribute-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === dragonCode);
    const level5Wind = restored.session.state.cards.find((card) => card.code === level5WindCode);
    const level4Wind = restored.session.state.cards.find((card) => card.code === level4WindCode);
    const level5Dark = restored.session.state.cards.find((card) => card.code === level5DarkCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(level5Wind).toBeDefined();
    expect(level4Wind).toBeDefined();
    expect(level5Dark).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, level5Wind!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, level4Wind!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, level5Dark!)).toBe(true);
  });

  it("restores original Type, Attribute, and Race Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dragonCode = "25784595";
    const darkDragonSynchroCode = "25784596";
    const lightDragonSynchroCode = "25784597";
    const darkFiendSynchroCode = "25784598";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonCode),
      { code: darkDragonSynchroCode, name: "Original DARK Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: lightDragonSynchroCode, name: "Original LIGHT Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: darkFiendSynchroCode, name: "Original DARK Fiend Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 257, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonCode], extra: [darkDragonSynchroCode, lightDragonSynchroCode, darkFiendSynchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${dragonCode}.lizfilter)
      `,
      "scarred-dragon-official-original-type-attribute-race-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-attribute-race:8192:32:8192",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
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
      "scarred-dragon-current-trait-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === dragonCode);
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
