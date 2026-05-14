import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wish Dragon Extra Level 5 Dragon lock", () => {
  it("restores its Extra Deck-only Level 5 or higher Dragon special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wishDragonCode = "64583600";
    const tokenCode = "64583601";
    const level5DragonCode = "900000451";
    const level6DragonCode = "900000452";
    const level4DragonCode = "900000453";
    const level5WarriorCode = "900000454";
    const deckCode = "900000455";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wishDragonCode),
      { code: tokenCode, name: "Dragon Token", kind: "monster", typeFlags: 0x4011, race: 0x2000, attribute: 0x1, level: 1, attack: 0, defense: 0 },
      { code: level5DragonCode, name: "Wish Dragon Level 5 Dragon Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x1, level: 5, attack: 1000, defense: 1000 },
      { code: level6DragonCode, name: "Wish Dragon Level 6 Dragon Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
      { code: level4DragonCode, name: "Wish Dragon Level 4 Dragon Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: level5WarriorCode, name: "Wish Dragon Level 5 Warrior Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x1, level: 5, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Wish Dragon Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 645, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wishDragonCode, deckCode], extra: [level5DragonCode, level6DragonCode, level4DragonCode, level5WarriorCode] }, 1: { main: [] } });
    startDuel(session);
    const wishDragon = session.state.cards.find((card) => card.code === wishDragonCode);
    expect(wishDragon).toBeDefined();
    moveDuelCard(session.state, wishDragon!.uid, "monsterZone", 0);
    wishDragon!.faceUp = true;
    wishDragon!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wishDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wishDragonCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${wishDragonCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "wish-dragon-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-level-above-race-extra:5:8192",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local level5_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5DragonCode}),0,LOCATION_EXTRA,0,nil)
      local level6_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level6DragonCode}),0,LOCATION_EXTRA,0,nil)
      local level4_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level4DragonCode}),0,LOCATION_EXTRA,0,nil)
      local level5_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5WarriorCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("wish level4 dragon special " .. Duel.SpecialSummon(level4_dragon,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wish level5 warrior special " .. Duel.SpecialSummon(level5_warrior,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("wish deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      Duel.SendtoGrave(deck,REASON_EFFECT)
      Debug.Message("wish level5 dragon special " .. Duel.SpecialSummon(level5_dragon,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Duel.SendtoGrave(level5_dragon,REASON_EFFECT)
      Debug.Message("wish level6 dragon special " .. Duel.SpecialSummon(level6_dragon,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "wish-dragon-extra-level5-dragon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "wish level4 dragon special 0",
        "wish level5 warrior special 0",
        "wish level5 dragon special 1",
        "wish level6 dragon special 1",
        "wish deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });

  it("restores its Clock Lizard Level 5 or higher Dragon check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wishDragonCode = "64583600";
    const level5DragonCode = "64583602";
    const level4DragonCode = "64583603";
    const level5WarriorCode = "64583604";
    const level4WarriorCode = "64583605";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wishDragonCode),
      { code: level5DragonCode, name: "Wish Lizard Level 5 Dragon Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x1, level: 5, attack: 1000, defense: 1000 },
      { code: level4DragonCode, name: "Wish Lizard Level 4 Dragon Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: level5WarriorCode, name: "Wish Lizard Level 5 Warrior Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x1, level: 5, attack: 1000, defense: 1000 },
      { code: level4WarriorCode, name: "Wish Lizard Level 4 Warrior Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 646, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wishDragonCode], extra: [level5DragonCode, level4DragonCode, level5WarriorCode, level4WarriorCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wishDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wishDragonCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,c${wishDragonCode}.lizfilter)
      `,
      "wish-dragon-official-level5-dragon-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-level-above-race:5:8192",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const mutate = restored.host.loadScript(
      `
      local level4_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level4DragonCode}),0,LOCATION_EXTRA,0,nil)
      local level5_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5WarriorCode}),0,LOCATION_EXTRA,0,nil)
      local level_change=Effect.CreateEffect(level4_dragon)
      level_change:SetType(EFFECT_TYPE_SINGLE)
      level_change:SetCode(EFFECT_CHANGE_LEVEL)
      level_change:SetValue(5)
      level4_dragon:RegisterEffect(level_change)
      local race_change=Effect.CreateEffect(level5_warrior)
      race_change:SetType(EFFECT_TYPE_SINGLE)
      race_change:SetCode(EFFECT_CHANGE_RACE)
      race_change:SetValue(RACE_DRAGON)
      level5_warrior:RegisterEffect(race_change)
      `,
      "wish-dragon-current-level-race-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === wishDragonCode);
    const level5Dragon = restored.session.state.cards.find((card) => card.code === level5DragonCode);
    const level4Dragon = restored.session.state.cards.find((card) => card.code === level4DragonCode);
    const level5Warrior = restored.session.state.cards.find((card) => card.code === level5WarriorCode);
    const level4Warrior = restored.session.state.cards.find((card) => card.code === level4WarriorCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(level5Dragon).toBeDefined();
    expect(level4Dragon).toBeDefined();
    expect(level5Warrior).toBeDefined();
    expect(level4Warrior).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, level5Dragon!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, level4Dragon!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, level5Warrior!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, level4Warrior!)).toBe(true);
  });
});
