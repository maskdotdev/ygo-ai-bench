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
});
