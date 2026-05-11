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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
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
});
