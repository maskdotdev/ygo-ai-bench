import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypePendulum, luaSummonTypeRitual, luaSummonTypeSpecial, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelCardData, DuelEffectContext } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

function valueContext(duel: DuelEffectContext["duel"], source: DuelEffectContext["source"], summonTypeCode: number, relatedEffectId?: number): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    summonTypeCode,
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
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

function expectRestoredLegalActionGroups(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua official special summon condition restore", () => {
  it("restores no-value special summon conditions as unconditional blocks", () => {
    const cards: DuelCardData[] = [{ code: "946", name: "No Special Summon Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 946, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["946"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c946.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "946")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:false" })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c946.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "946")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:false" });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(false);
  });

  it("restores direct type or related handler code predicates", () => {
    const cards: DuelCardData[] = [
      { code: "950", name: "Type Or Code Probe", kind: "extra", typeFlags: 0x41 },
      { code: "1784686", name: "The Eye of Timaeus", kind: "spell" },
      { code: "951", name: "Other Spell", kind: "spell" },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION or se:GetHandler():IsCode(1784686)
      end
      `;
    const session = createDuel({ seed: 950, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["1784686", "951"], extra: ["950"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c950.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "950")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:type-or-related-handler-code:${luaSummonTypeFusion}:1784686` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c950.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "950")!;
    const matchingSpell = restored.session.state.cards.find((card) => card.code === "1784686")!;
    const otherSpell = restored.session.state.cards.find((card) => card.code === "951")!;
    restored.session.state.effects.push({ id: "lua-5250", sourceUid: otherSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5251", sourceUid: matchingSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:type-or-related-handler-code:${luaSummonTypeFusion}:1784686` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5250))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5251))).toBe(true);
  });

  it("restores related handler setcode special summon conditions", () => {
    const hazySetcode = 0x107d;
    const cards: DuelCardData[] = [
      { code: "947", name: "Hazy-Style Probe", kind: "monster", typeFlags: 0x81 },
      { code: "948", name: "Hazy Effect", kind: "monster", typeFlags: 0x81, setcodes: [hazySetcode] },
      { code: "949", name: "Other Effect", kind: "monster", typeFlags: 0x81 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      s.listed_series={SET_HAZY_FLAME}
      function s.splimit(e,se,sp,st)
        return se:GetHandler():IsSetCard(SET_HAZY_FLAME)
      end
      `;
    const session = createDuel({ seed: 947, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["947", "948", "949"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c947.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "947")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:related-handler-setcode:${hazySetcode}` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c947.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "947")!;
    const hazyEffectSource = restored.session.state.cards.find((card) => card.code === "948")!;
    const otherEffectSource = restored.session.state.cards.find((card) => card.code === "949")!;
    restored.session.state.effects.push({ id: "lua-5450", sourceUid: otherEffectSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5451", sourceUid: hazyEffectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", luaTypeFlags: 0x800, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:related-handler-setcode:${hazySetcode}` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5450))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5451))).toBe(true);
  });

  it("restores monster related handler race special summon conditions", () => {
    const raceWyrm = 0x800000;
    const cards: DuelCardData[] = [
      { code: "952", name: "Mare-Style Probe", kind: "monster", typeFlags: 0x81 },
      { code: "953", name: "Wyrm Effect", kind: "monster", typeFlags: 0x81, race: raceWyrm },
      { code: "954", name: "Spell Effect", kind: "spell" },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return se:IsMonsterEffect() and se:GetHandler():IsRace(RACE_WYRM)
      end
      `;
    const session = createDuel({ seed: 952, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["952", "953", "954"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c952.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "952")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:monster-related-handler-race:${raceWyrm}` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c952.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "952")!;
    const wyrmEffectSource = restored.session.state.cards.find((card) => card.code === "953")!;
    const spellEffectSource = restored.session.state.cards.find((card) => card.code === "954")!;
    restored.session.state.effects.push({ id: "lua-5550", sourceUid: spellEffectSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5551", sourceUid: wyrmEffectSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:monster-related-handler-race:${raceWyrm}` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5550))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5551))).toBe(true);
  });

  it("restores source location and summon type special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "955", name: "Location Type Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return e:GetHandler():IsLocation(LOCATION_HAND) and (st&SUMMON_TYPE_RITUAL)==SUMMON_TYPE_RITUAL
      end
      `;
    const session = createDuel({ seed: 955, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["955"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c955.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "955")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:source-location-and-type:2:${luaSummonTypeRitual}` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c955.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "955")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:source-location-and-type:2:${luaSummonTypeRitual}` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    restoredSource.location = "hand";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeRitual))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeRitual))).toBe(false);
  });

  it("restores source location and previous location special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "956", name: "Previous Location Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.spcon)
        c:RegisterEffect(e)
      end
      function s.spcon(e)
        return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)
      end
      `;
    const session = createDuel({ seed: 956, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["956"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "956")!;
    source.location = "graveyard";
    source.previousLocation = "monsterZone";
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c956.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:source-location-and-previous-location:16:12" })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c956.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "956")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:source-location-and-previous-location:16:12" });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
    restoredSource.previousLocation = "hand";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
  });

  it("restores summon-player empty monster zone special summon conditions", () => {
    const cards: DuelCardData[] = [
      { code: "957", name: "Empty MZone Probe", kind: "monster", typeFlags: 0x81 },
      { code: "958", name: "Field Blocker", kind: "monster", typeFlags: 0x81 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.sumlimit)
        c:RegisterEffect(e)
      end
      function s.sumlimit(e,se,sp,st,pos,tp)
        return Duel.GetFieldGroupCount(sp,LOCATION_MZONE,0)==0
      end
      `;
    const session = createDuel({ seed: 957, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["957", "958"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c957.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "957")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:summon-player-empty-mzone" })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c957.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "957")!;
    const blocker = restored.session.state.cards.find((card) => card.code === "958")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:summon-player-empty-mzone" });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
    blocker.location = "monsterZone";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
  });

  it("restores monster related handler setcode or setcode special summon conditions", () => {
    const ninja = 0x2b;
    const ninjitsu = 0x61;
    const cards: DuelCardData[] = [
      { code: "959", name: "Black Dragon Ninja Probe", kind: "monster", typeFlags: 0x81 },
      { code: "960", name: "Ninja Monster", kind: "monster", typeFlags: 0x81, setcodes: [ninja] },
      { code: "961", name: "Ninjitsu Spell", kind: "spell", setcodes: [ninjitsu] },
      { code: "962", name: "Ninja Spell", kind: "spell", setcodes: [ninja] },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (se:IsMonsterEffect() and se:GetHandler():IsSetCard(SET_NINJA)) or se:GetHandler():IsSetCard(SET_NINJITSU_ART)
      end
      `;
    const session = createDuel({ seed: 959, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["959", "960", "961", "962"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c959.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "959")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:monster-related-handler-setcode-or-setcode:${ninja}:${ninjitsu}` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c959.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "959")!;
    const ninjaMonster = restored.session.state.cards.find((card) => card.code === "960")!;
    const ninjitsuSpell = restored.session.state.cards.find((card) => card.code === "961")!;
    const ninjaSpell = restored.session.state.cards.find((card) => card.code === "962")!;
    restored.session.state.effects.push({ id: "lua-5950", sourceUid: ninjaSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5951", sourceUid: ninjaMonster.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5952", sourceUid: ninjitsuSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:monster-related-handler-setcode-or-setcode:${ninja}:${ninjitsu}` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5950))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5951))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5952))).toBe(true);
  });

  it("restores type or source location and type special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "963", name: "Odd-Eyes Pendulumgraph Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (st&SUMMON_TYPE_RITUAL)==SUMMON_TYPE_RITUAL or ((st&SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM
          and e:GetHandler():IsLocation(LOCATION_HAND))
      end
      `;
    const session = createDuel({ seed: 963, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["963"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c963.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "963")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:type-or-source-location-and-type:${luaSummonTypeRitual}:2:${luaSummonTypePendulum}` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c963.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "963")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:type-or-source-location-and-type:${luaSummonTypeRitual}:2:${luaSummonTypePendulum}` });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeRitual))).toBe(true);
    restoredSource.location = "hand";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypePendulum))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypePendulum))).toBe(false);
  });

  it("restores numeric zero special summon conditions as unconditional blocks", () => {
    const cards: DuelCardData[] = [{ code: "964", name: "Numeric Zero Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(0)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 964, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["964"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c964.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "964")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:false" })]);
  });

  it("restores not related handler monster special summon conditions", () => {
    const cards: DuelCardData[] = [
      { code: "965", name: "Vennominon Probe", kind: "monster", typeFlags: 0x81 },
      { code: "966", name: "Monster Effect", kind: "monster", typeFlags: 0x81 },
      { code: "967", name: "Spell Effect", kind: "spell" },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return not se:GetHandler():IsMonster()
      end
      `;
    const session = createDuel({ seed: 965, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["965", "966", "967"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c965.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "965")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:not-related-handler-monster" })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c965.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const monster = restored.session.state.cards.find((card) => card.code === "966")!;
    const spell = restored.session.state.cards.find((card) => card.code === "967")!;
    restored.session.state.effects.push({ id: "lua-6050", sourceUid: monster.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-6051", sourceUid: spell.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredSource = restored.session.state.cards.find((card) => card.code === "965")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 6050))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 6051))).toBe(true);
  });

  it("restores anonymous card-effect-only special summon conditions without summon type parameters", () => {
    const cards: DuelCardData[] = [
      { code: "968", name: "Action Only Probe", kind: "monster", typeFlags: 0x81 },
      { code: "969", name: "Action Spell", kind: "spell" },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(function(_,se) return se:IsHasType(EFFECT_TYPE_ACTIONS) end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 968, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["968", "969"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c968.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "968")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:card-effect" })]);
  });

  it("restores non-type or player grave setcode special summon conditions", () => {
    const worldLegacy = 0xfe;
    const cards: DuelCardData[] = [
      { code: "970", name: "Lib Probe", kind: "extra", typeFlags: 0x1 },
      { code: "971", name: "World Legacy Card", kind: "spell", setcodes: [worldLegacy] },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (st&SUMMON_TYPE_LINK)~=SUMMON_TYPE_LINK or Duel.IsExistingMatchingCard(Card.IsSetCard,sp,LOCATION_GRAVE,0,1,nil,SET_WORLD_LEGACY)
      end
      `;
    const session = createDuel({ seed: 970, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["971"], extra: ["970"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c970.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "970")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:not-type-or-player-grave-setcode:${luaSummonTypeLink}:${worldLegacy}` })]);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c970.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "970")!;
    const legacy = restored.session.state.cards.find((card) => card.code === "971")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid)!;
    expect(restoredEffect.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
    expect(restoredEffect.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(false);
    legacy.location = "graveyard";
    expect(restoredEffect.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(true);
  });

  it("restores non-type or phase special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "972", name: "Main2 Link Probe", kind: "extra", typeFlags: 0x1 }];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (st&SUMMON_TYPE_LINK)~=SUMMON_TYPE_LINK or Duel.IsPhase(PHASE_MAIN2)
      end
      `;
    const session = createDuel({ seed: 972, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: ["972"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c972.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "972")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:not-type-or-phase:${luaSummonTypeLink}:256` })]);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c972.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "972")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid)!;
    restored.session.state.phase = "main1";
    expect(restoredEffect.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(false);
    restored.session.state.phase = "main2";
    expect(restoredEffect.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(true);
  });

  it("restores related handler spell/trap setcode and type-race conditions", () => {
    const bonding = 0x100;
    const cards: DuelCardData[] = [
      { code: "973", name: "Bonding Probe", kind: "monster", typeFlags: 0x81 },
      { code: "974", name: "Bonding Spell", kind: "spell", setcodes: [bonding] },
      { code: "975", name: "Dragon Xyz", kind: "extra", typeFlags: 0x800001, race: 0x2000 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        local sc=se:GetHandler()
        return sc and sc:IsSpellTrap() and sc:IsSetCard(SET_BONDING)
      end
      `;
    const session = createDuel({ seed: 973, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["973", "974"], extra: ["975"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c973.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "973")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:related-handler-spelltrap-setcode:${bonding}` })]);

    const xyzScript = script.replace("sc and sc:IsSpellTrap() and sc:IsSetCard(SET_BONDING)", "sc:IsType(TYPE_XYZ) and sc:IsRace(RACE_DRAGON)");
    const xyzSession = createDuel({ seed: 974, startingHandSize: 0, cardReader: reader });
    loadDecks(xyzSession, { 0: { main: ["973", "974"], extra: ["975"] }, 1: { main: [] } });
    startDuel(xyzSession);
    const xyzHost = createLuaScriptHost(xyzSession);
    expect(xyzHost.loadScript(xyzScript, "c973.lua").ok).toBe(true);
    expect(xyzHost.registerInitialEffects()).toBe(1);
    const xyzSource = xyzSession.state.cards.find((card) => card.code === "973")!;
    expect(xyzSession.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: xyzSource.uid, luaValueDescriptor: "special-summon-condition:related-handler-type-race:8388608:8192" })]);
  });

  it("restores negated target-player face-up code conditions", () => {
    const cards: DuelCardData[] = [
      { code: "976", name: "Face-Up Code Probe", kind: "monster", typeFlags: 0x81 },
      { code: "976", name: "Face-Up Code Probe", kind: "monster", typeFlags: 0x81 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st,spos,tgp)
        return not Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,id),tgp,LOCATION_ONFIELD,0,1,nil)
      end
      `;
    const session = createDuel({ seed: 976, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["976", "976"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c976.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const source = session.state.cards.find((card) => card.code === "976")!;
    expect(session.state.effects).toContainEqual(expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:target-player-no-field-faceup-code:976" }));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c976.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const [restoredSource, duplicate] = restored.session.state.cards.filter((card) => card.code === "976");
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource!.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:target-player-no-field-faceup-code:976" });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource!, luaSummonTypeSpecial))).toBe(true);
    moveDuelCard(restored.session.state, duplicate!.uid, "monsterZone", 0).position = "faceUpAttack";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource!, luaSummonTypeSpecial))).toBe(false);
  });

  it("restores not-extra or graveyard Spell/Trap setcode count conditions", () => {
    const triBrigade = 0x14f;
    const cards: DuelCardData[] = [
      { code: "977", name: "Tri-Brigade Link Probe", kind: "extra", typeFlags: 0x4000001 },
      { code: "978", name: "Tri-Brigade Spell A", kind: "spell", setcodes: [triBrigade] },
      { code: "979", name: "Tri-Brigade Spell B", kind: "spell", setcodes: [triBrigade] },
      { code: "980", name: "Tri-Brigade Trap", kind: "trap", setcodes: [triBrigade] },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return not e:GetHandler():IsLocation(LOCATION_EXTRA) or Duel.IsExistingMatchingCard(s.spcostfilter,sp,LOCATION_GRAVE,0,3,nil)
      end
      `;
    const session = createDuel({ seed: 977, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["978", "979", "980"], extra: ["977"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c977.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "977")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: "special-summon-condition:not-extra-or-player-grave-spelltrap-setcode-count:335:3" })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c977.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "977")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(false);
    for (const card of restored.session.state.cards.filter((card) => card.code !== "977")) moveDuelCard(restored.session.state, card.uid, "graveyard", 0);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(true);
  });

  it("restores Link-only Pendulum Zone original-race counter sum conditions", () => {
    const resonance = 0x211;
    const cards: DuelCardData[] = [
      { code: "981", name: "Vaalmonica Link Probe", kind: "extra", typeFlags: 0x4000001 },
      { code: "982", name: "Fairy Pendulum", kind: "monster", typeFlags: 0x1000001, race: 0x4 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.splimit)
        c:RegisterEffect(e)
      end
      function s.splimit(e,se,sp,st)
        return (st&SUMMON_TYPE_LINK)~=SUMMON_TYPE_LINK or Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsOriginalRace,RACE_FAIRY),sp,LOCATION_PZONE,0,nil):GetSum(Card.GetCounter,COUNTER_RESONANCE)>=3
      end
      `;
    const session = createDuel({ seed: 981, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["982"], extra: ["981"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c981.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "981")!;
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 30, sourceUid: source.uid, luaValueDescriptor: `special-summon-condition:not-type-or-player-pzone-original-race-counter-sum:${luaSummonTypeLink}:4:${resonance}:3` })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c981.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "981")!;
    const scale = restored.session.state.cards.find((card) => card.code === "982")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(false);
    moveDuelCard(restored.session.state, scale.uid, "spellTrapZone", 0).sequence = 0;
    scale.faceUp = true;
    addDuelCardCounter(scale, resonance, 3);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeLink))).toBe(true);
  });
});
