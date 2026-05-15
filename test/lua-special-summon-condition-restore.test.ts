import { describe, expect, it } from "vitest";
import { duelActivity } from "#duel/activity.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypePendulum, luaSummonTypeRitual, luaSummonTypeSpecial, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelCardData, DuelEffectContext } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

function valueContext(duel: DuelEffectContext["duel"], source: DuelEffectContext["source"], summonTypeCode: number, relatedEffectId?: number, player: 0 | 1 = 0): DuelEffectContext {
  return {
    duel,
    source,
    player,
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua special summon condition restore", () => {
  it("restores official aux.FALSE special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "935", name: "Inline Cannot Special Summon Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      c935={}
      function c935.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(aux.FALSE)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 935, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["935"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c935.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "935")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: "special-summon-condition:false",
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c935.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "935")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:false" });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(false);
    restoredSource.location = "graveyard";
    restoredSource.customStatusMask = 0x8;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
  });

  it.each([
    {
      label: "type-only",
      code: "920",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: `special-summon-condition:type:${luaSummonTypeFusion}`,
      valueBody: "return (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION",
      acceptedType: luaSummonTypeFusion,
      acceptsGenericAfterMove: false,
      completeAcceptsGeneric: false,
    },
    {
      label: "type-only multi",
      code: "932",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: `special-summon-condition:types:${luaSummonTypeFusion},${luaSummonTypePendulum}`,
      valueBody: "return (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION or (st&SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM",
      acceptedType: luaSummonTypeFusion,
      acceptedTypes: [luaSummonTypeFusion, luaSummonTypePendulum],
      acceptsGenericAfterMove: false,
      completeAcceptsGeneric: false,
    },
    {
      label: "exact custom type or Pendulum",
      code: "933",
      kind: "monster" as const,
      deck: "main" as const,
      descriptor: `special-summon-condition:exact-types:${luaSummonTypeSpecial + 101}:types:${luaSummonTypePendulum}`,
      valueBody: "return st==(SUMMON_TYPE_SPECIAL+101) or st&SUMMON_TYPE_PENDULUM==SUMMON_TYPE_PENDULUM",
      acceptedType: luaSummonTypeSpecial + 101,
      acceptedTypes: [luaSummonTypeSpecial + 101, luaSummonTypePendulum],
      acceptsGenericAfterMove: false,
      completeAcceptsGeneric: false,
    },
    {
      label: "extra-or-type",
      code: "921",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: `special-summon-condition:extra-or-type:${luaSummonTypeSynchro}`,
      valueBody: "return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st&SUMMON_TYPE_SYNCHRO)==SUMMON_TYPE_SYNCHRO",
      acceptedType: luaSummonTypeSynchro,
      acceptsGenericAfterMove: true,
      completeAcceptsGeneric: false,
    },
    {
      label: "extra-or-type GetLocation",
      code: "929",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: `special-summon-condition:extra-or-type:${luaSummonTypeFusion}`,
      valueBody: "return (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION or e:GetHandler():GetLocation()~=LOCATION_EXTRA",
      acceptedType: luaSummonTypeFusion,
      acceptsGenericAfterMove: true,
      completeAcceptsGeneric: false,
    },
    {
      label: "not-extra GetLocation",
      code: "930",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: "special-summon-condition:not-extra",
      valueBody: "return e:GetHandler():GetLocation()~=LOCATION_EXTRA",
      acceptedType: luaSummonTypeSpecial,
      acceptsGenericAfterMove: true,
      completeAcceptsGeneric: false,
    },
    {
      label: "proc-complete-or-type",
      code: "922",
      kind: "monster" as const,
      deck: "main" as const,
      descriptor: `special-summon-condition:proc-complete-or-type:${luaSummonTypeRitual}`,
      valueBody: "return e:GetHandler():IsStatus(STATUS_PROC_COMPLETE) or (st&SUMMON_TYPE_RITUAL)==SUMMON_TYPE_RITUAL",
      acceptedType: luaSummonTypeRitual,
      acceptsGenericAfterMove: false,
      completeAcceptsGeneric: true,
    },
    {
      label: "extra-or-type no related effect",
      code: "931",
      kind: "extra" as const,
      deck: "extra" as const,
      descriptor: `special-summon-condition:extra-or-type-no-related:${luaSummonTypeSynchro}`,
      valueBody: "return not e:GetHandler():IsLocation(LOCATION_EXTRA) or ((st&SUMMON_TYPE_SYNCHRO)==SUMMON_TYPE_SYNCHRO and not se)",
      acceptedType: luaSummonTypeSynchro,
      acceptsGenericAfterMove: true,
      completeAcceptsGeneric: false,
    },
  ])("restores inline $label special summon condition predicates", ({ code, kind, deck, descriptor, valueBody, acceptedType, acceptedTypes, acceptsGenericAfterMove, completeAcceptsGeneric }) => {
    const cards: DuelCardData[] = [{ code, name: `Inline ${descriptor} Probe`, kind, typeFlags: kind === "extra" ? 0x2001 : 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      c${code}={}
      function c${code}.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(function(e,se,sp,st)
          ${valueBody}
        end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: Number(code), startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: deck === "main" ? [code] : [], extra: deck === "extra" ? [code] : [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, `c${code}.lua`).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === code)!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: descriptor,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === `c${code}.lua` ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === code)!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: descriptor });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    for (const accepted of acceptedTypes ?? [acceptedType]) {
      if (accepted !== luaSummonTypeSpecial) expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, accepted))).toBe(true);
    }
    if (descriptor.includes("no-related")) {
      restored.session.state.effects.push({ id: "lua-5200", sourceUid: restoredSource.uid, controller: 0, ownerPlayer: 0, event: "trigger", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
      expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, acceptedType, 5200))).toBe(false);
    }
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(acceptsGenericAfterMove);
    restoredSource.customStatusMask = 0x8;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(completeAcceptsGeneric || acceptsGenericAfterMove);
  });

  it.each([
    {
      label: "Fusion aux limit extra fallback",
      code: "923",
      descriptor: `special-summon-condition:extra-or-type:${luaSummonTypeFusion}`,
      valueBody: "return aux.fuslimit(e,se,sp,st) or not e:GetHandler():IsLocation(LOCATION_EXTRA)",
      acceptedTypes: [luaSummonTypeFusion],
    },
    {
      label: "Fusion or Pendulum aux limit extra fallback",
      code: "924",
      descriptor: `special-summon-condition:extra-or-types:${luaSummonTypeFusion},${luaSummonTypePendulum}`,
      valueBody: "return not e:GetHandler():IsLocation(LOCATION_EXTRA) or aux.fuslimit(e,se,sp,st) or aux.penlimit(e,se,sp,st)",
      acceptedTypes: [luaSummonTypeFusion, luaSummonTypePendulum],
    },
  ])("restores official-style inline $label predicates", ({ code, descriptor, valueBody, acceptedTypes }) => {
    const cards: DuelCardData[] = [{ code, name: `Inline ${descriptor} Probe`, kind: "extra", typeFlags: 0x41 }];
    const reader = createCardReader(cards);
    const script = `
      c${code}={}
      function c${code}.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(function(e,se,sp,st)
          ${valueBody}
        end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: Number(code), startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [code] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, `c${code}.lua`).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === code)!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: descriptor,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === `c${code}.lua` ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === code)!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: descriptor });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    for (const acceptedType of acceptedTypes) {
      expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, acceptedType))).toBe(true);
    }
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it("restores official-style inline Ritual limit or related handler code predicates", () => {
    const cards: DuelCardData[] = [
      { code: "925", name: "Inline Ritual Related Handler Probe", kind: "monster", typeFlags: 0x81 },
      { code: "94997874", name: "Prediction Princess Ritual Spell Probe", kind: "spell", typeFlags: 0x2 },
      { code: "94997875", name: "Other Ritual Spell Probe", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const script = `
      c925={}
      function c925.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(function(e,se,sp,st)
          return aux.ritlimit(e,se,sp,st) or se:GetHandler():IsCode(94997874)
        end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 925, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["925", "94997874", "94997875"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c925.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "925")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:type-or-related-handler-code:${luaSummonTypeRitual}:94997874`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c925.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "925")!;
    const matchingSpell = restored.session.state.cards.find((card) => card.code === "94997874")!;
    const otherSpell = restored.session.state.cards.find((card) => card.code === "94997875")!;
    restored.session.state.effects.push({ id: "lua-5000", sourceUid: matchingSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5001", sourceUid: otherSpell.uid, controller: 0, ownerPlayer: 0, event: "ignition", range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:type-or-related-handler-code:${luaSummonTypeRitual}:94997874` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeRitual))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5001))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5000))).toBe(true);
  });

  it("restores official-style not-in-location-mask special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "934", name: "Inline Contact Fusion Location Probe", kind: "extra", typeFlags: 0x41 }];
    const reader = createCardReader(cards);
    const script = `
      c934={}
      function c934.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(function(e,se,sp,st)
          return not e:GetHandler():IsLocation(LOCATION_EXTRA|LOCATION_GRAVE)
        end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 934, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: ["934"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c934.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "934")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: "special-summon-condition:not-locations:80",
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c934.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "934")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:not-locations:80" });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    restoredSource.location = "monsterZone";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it.each([
    {
      label: "official named action-type predicate",
      code: "926",
      value: "s.splimit",
      helper: `
        function s.splimit(e,se,sp,st)
          return se:IsHasType(EFFECT_TYPE_ACTIONS)
        end
      `,
    },
    {
      label: "local card-effect helper predicate",
      code: "927",
      value: "function(e,sum_eff,sum_p,sum_type) return sum_eff and sum_eff:IsHasType(EFFECT_TYPE_ACTIONS) or false end",
      helper: "",
    },
  ])("restores $label special summon conditions", ({ code, value, helper }) => {
    const cards: DuelCardData[] = [
      { code, name: "Card Effect Special Summon Probe", kind: "monster", typeFlags: 0x1 },
      { code: "928", name: "Effect Source Probe", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(${value})
        c:RegisterEffect(e)
      end
      ${helper}
      `;
    const session = createDuel({ seed: Number(code), startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [code, "928"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, `c${code}.lua`).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === code)!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: "special-summon-condition:card-effect",
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === `c${code}.lua` ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === code)!;
    const effectSource = restored.session.state.cards.find((card) => card.code === "928")!;
    restored.session.state.effects.push({ id: "lua-5100", sourceUid: effectSource.uid, controller: 0, ownerPlayer: 0, event: "trigger", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5101", sourceUid: effectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", luaTypeFlags: 0x800, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:card-effect" });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5101))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5100))).toBe(true);
  });

  it("restores official-style action related handler setcode special summon conditions", () => {
    const drytronSetcode = 0x151;
    const cards: DuelCardData[] = [
      { code: "936", name: "Drytron Condition Probe", kind: "monster", typeFlags: 0x1 },
      { code: "937", name: "Drytron Effect Source Probe", kind: "monster", typeFlags: 0x1, setcodes: [drytronSetcode] },
      { code: "938", name: "Other Effect Source Probe", kind: "monster", typeFlags: 0x1 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.spconlimit)
        c:RegisterEffect(e)
      end
      function s.spconlimit(e,se,sp,st)
        return se:IsHasType(EFFECT_TYPE_ACTIONS) and se:GetHandler():IsSetCard(SET_DRYTRON)
      end
      `;
    const session = createDuel({ seed: 936, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["936", "937", "938"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c936.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "936")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:card-effect-handler-setcode:${drytronSetcode}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c936.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "936")!;
    const drytronEffectSource = restored.session.state.cards.find((card) => card.code === "937")!;
    const otherEffectSource = restored.session.state.cards.find((card) => card.code === "938")!;
    restored.session.state.effects.push({ id: "lua-5300", sourceUid: drytronEffectSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5301", sourceUid: otherEffectSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5302", sourceUid: drytronEffectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", luaTypeFlags: 0x800, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:card-effect-handler-setcode:${drytronSetcode}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5301))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5302))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5300))).toBe(true);
  });

  it("restores official aux.EvilHeroLimit special summon conditions", () => {
    const cards: DuelCardData[] = [
      { code: "939", name: "Evil HERO Limit Probe", kind: "extra", typeFlags: 0x41 },
      { code: "94820406", name: "Dark Fusion", kind: "spell" },
      { code: "48130397", name: "Super Polymerization", kind: "spell" },
      { code: "940", name: "Player Effect Source Probe", kind: "monster", typeFlags: 0x1 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(aux.EvilHeroLimit)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 939, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["94820406", "48130397", "940"], extra: ["939"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c939.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "939")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: "special-summon-condition:evil-hero-limit",
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c939.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "939")!;
    const darkFusion = restored.session.state.cards.find((card) => card.code === "94820406")!;
    const superPoly = restored.session.state.cards.find((card) => card.code === "48130397")!;
    const playerEffectSource = restored.session.state.cards.find((card) => card.code === "940")!;
    playerEffectSource.location = "monsterZone";
    playerEffectSource.sequence = 0;
    playerEffectSource.faceUp = true;
    restored.session.state.effects.push({ id: "lua-5400", sourceUid: darkFusion.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5401", sourceUid: superPoly.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:evil-hero-limit" });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5400))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion, 5401))).toBe(false);

    restored.session.state.effects.push({ id: "lua-5402", sourceUid: playerEffectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", code: 300306009, range: ["monsterZone"], targetRange: [1, 0], operation: () => undefined });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion, 5401))).toBe(true);
    restored.session.state.effects = restored.session.state.effects.filter((effect) => effect.id !== "lua-5402");
    restored.session.state.effects.push({ id: "lua-5403", sourceUid: playerEffectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", code: 72043279, range: ["monsterZone"], targetRange: [1, 0], operation: () => undefined });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
  });

  it("restores official aux.FossilLimit special summon conditions", () => {
    const cards: DuelCardData[] = [
      { code: "941", name: "Fossil Limit Probe", kind: "extra", typeFlags: 0x41 },
      { code: "59419719", name: "Fossil Fusion", kind: "spell" },
      { code: "48130397", name: "Super Polymerization", kind: "spell" },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(aux.FossilLimit)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 941, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["59419719", "48130397"], extra: ["941"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c941.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "941")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: "special-summon-condition:fossil-limit",
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c941.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "941")!;
    const fossilFusion = restored.session.state.cards.find((card) => card.code === "59419719")!;
    const superPoly = restored.session.state.cards.find((card) => card.code === "48130397")!;
    restored.session.state.effects.push({ id: "lua-5500", sourceUid: fossilFusion.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    restored.session.state.effects.push({ id: "lua-5501", sourceUid: superPoly.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: "special-summon-condition:fossil-limit" });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion, 5501))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion, 5500))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it("restores official-style summon type or player flag absent special summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "942", name: "Flag-Gated Xyz Probe", kind: "extra", typeFlags: 0x801 }];
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
        return (st&SUMMON_TYPE_XYZ)~=SUMMON_TYPE_XYZ or Duel.GetFlagEffect(tgp,id)==0
      end
      `;
    const session = createDuel({ seed: 942, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: ["942"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c942.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "942")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:not-type-or-player-flag-absent:${luaSummonTypeXyz}:942`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c942.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "942")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:not-type-or-player-flag-absent:${luaSummonTypeXyz}:942` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeXyz))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    restored.session.state.flagEffects.push({ ownerType: "player", ownerId: "0", code: 942, reset: 0, property: 0, value: 0, turn: restored.session.state.turn });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeXyz))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeXyz, undefined, 1))).toBe(true);
  });

  it("restores official-style exact summon type player effect controller special summon conditions", () => {
    const rebornSummonType = luaSummonTypeSpecial + 1010;
    const cards: DuelCardData[] = [
      { code: "943", name: "Ra-Style Reborn Probe", kind: "monster", typeFlags: 0x81 },
      { code: "944", name: "Player Effect Source", kind: "monster", typeFlags: 0x81 },
    ];
    const reader = createCardReader(cards);
    const script = `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_CONDITION)
        e:SetValue(s.spval)
        c:RegisterEffect(e)
      end
      function s.spval(e,se,sp,st)
        return st==SUMMON_TYPE_SPECIAL+SUMMON_WITH_MONSTER_REBORN and Duel.IsPlayerAffectedByEffect(sp,41044418) and e:GetHandler():IsControler(sp)
      end
      `;
    const session = createDuel({ seed: 943, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["943", "944"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c943.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "943")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:exact-type-player-affected-controller:${rebornSummonType}:41044418`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c943.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "943")!;
    const playerEffectSource = restored.session.state.cards.find((card) => card.code === "944")!;
    playerEffectSource.location = "monsterZone";
    playerEffectSource.sequence = 0;
    playerEffectSource.faceUp = true;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:exact-type-player-affected-controller:${rebornSummonType}:41044418` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, rebornSummonType))).toBe(false);
    restored.session.state.effects.push({ id: "lua-5600", sourceUid: playerEffectSource.uid, controller: 0, ownerPlayer: 0, event: "continuous", code: 41044418, range: ["monsterZone"], targetRange: [1, 0], operation: () => undefined });
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, rebornSummonType))).toBe(true);
    restoredSource.controller = 1;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, rebornSummonType))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, rebornSummonType, undefined, 1))).toBe(false);
  });

  it("restores official-style action no activity phase turn player special summon conditions", () => {
    const luaPhaseMain1 = 0x4;
    const cards: DuelCardData[] = [{ code: "945", name: "Zap-Style Activity Probe", kind: "monster", typeFlags: 0x81 }];
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
        return se:IsHasType(EFFECT_TYPE_ACTIONS) and Duel.GetActivityCount(e:GetHandlerPlayer(),ACTIVITY_SPSUMMON)==0
          and Duel.IsPhase(PHASE_MAIN1) and Duel.GetTurnPlayer()==e:GetHandlerPlayer()
      end
      `;
    const session = createDuel({ seed: 945, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["945"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c945.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "945")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:action-no-activity-phase-turn-player:${duelActivity.specialSummon}:${luaPhaseMain1}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c945.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "945")!;
    restored.session.state.effects.push({ id: "lua-5700", sourceUid: restoredSource.uid, controller: 0, ownerPlayer: 0, event: "ignition", luaTypeFlags: 0x80, range: ["hand"], operation: () => undefined });
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:action-no-activity-phase-turn-player:${duelActivity.specialSummon}:${luaPhaseMain1}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    restored.session.state.phase = "draw";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5700))).toBe(false);
    restored.session.state.phase = "main1";
    restored.session.state.turnPlayer = 0;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5700))).toBe(true);
    restored.session.state.activityCounts[0].specialSummon = 1;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5700))).toBe(false);
    restored.session.state.activityCounts[0].specialSummon = 0;
    restored.session.state.turnPlayer = 1;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial, 5700))).toBe(false);
  });

  it("restores must-be-Fusion summon value predicates", () => {
    const cards: DuelCardData[] = [{ code: "901", name: "Must Fusion Probe", kind: "extra", typeFlags: 0x41 }];
    const reader = createCardReader(cards);
    const script = `
      c901={}
      function c901.initial_effect(c)
        c:AddMustBeFusionSummoned()
      end
      `;
    const session = createDuel({ seed: 431, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: ["901"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c901.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "901")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:type:${luaSummonTypeFusion}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c901.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "901")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:type:${luaSummonTypeFusion}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
  });

  it.each([
    { label: "Ritual", code: "907", helper: "AddMustBeRitualSummoned", summonType: luaSummonTypeRitual, kind: "monster" as const, typeFlags: 0x81, deck: "main" as const },
    { label: "Synchro", code: "908", helper: "AddMustBeSynchroSummoned", summonType: luaSummonTypeSynchro, kind: "extra" as const, typeFlags: 0x2001, deck: "extra" as const },
    { label: "Xyz", code: "909", helper: "AddMustBeXyzSummoned", summonType: luaSummonTypeXyz, kind: "extra" as const, typeFlags: 0x800001, deck: "extra" as const },
    { label: "Pendulum", code: "910", helper: "AddMustBePendulumSummoned", summonType: luaSummonTypePendulum, kind: "monster" as const, typeFlags: 0x1000001, deck: "main" as const },
    { label: "Link", code: "911", helper: "AddMustBeLinkSummoned", summonType: luaSummonTypeLink, kind: "extra" as const, typeFlags: 0x4000001, deck: "extra" as const },
  ])("restores must-be-$label summon value predicates", ({ code, helper, summonType, kind, typeFlags, deck }) => {
    const cards: DuelCardData[] = [{ code, name: `Must ${helper} Probe`, kind, typeFlags }];
    const reader = createCardReader(cards);
    const script = `
      c${code}={}
      function c${code}.initial_effect(c)
        c:${helper}()
      end
      `;
    const session = createDuel({ seed: Number(code), startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: deck === "main" ? [code] : [], extra: deck === "extra" ? [code] : [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, `c${code}.lua`).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === code)!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:type:${summonType}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === `c${code}.lua` ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === code)!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:type:${summonType}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, summonType))).toBe(true);
    restoredSource.customStatusMask = 0x8;
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
  });

  it("restores must-first-be-Fusion summon value predicates", () => {
    const cards: DuelCardData[] = [{ code: "900", name: "Must First Fusion Probe", kind: "extra", typeFlags: 0x41 }];
    const reader = createCardReader(cards);
    const script = `
      c900={}
      function c900.initial_effect(c)
        c:AddMustFirstBeFusionSummoned()
      end
      `;
    const session = createDuel({ seed: 430, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c900.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "900")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:extra-or-type:${luaSummonTypeFusion}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c900.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "900")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:extra-or-type:${luaSummonTypeFusion}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeFusion))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it.each([
    { label: "Synchro", code: "904", helper: "AddMustFirstBeSynchroSummoned", summonType: luaSummonTypeSynchro, typeFlags: 0x2001 },
    { label: "Xyz", code: "905", helper: "AddMustFirstBeXyzSummoned", summonType: luaSummonTypeXyz, typeFlags: 0x800001 },
    { label: "Link", code: "906", helper: "AddMustFirstBeLinkSummoned", summonType: luaSummonTypeLink, typeFlags: 0x4000001 },
  ])("restores must-first-be-$label summon value predicates", ({ code, helper, summonType, typeFlags }) => {
    const cards: DuelCardData[] = [{ code, name: `Must First ${helper} Probe`, kind: "extra", typeFlags }];
    const reader = createCardReader(cards);
    const script = `
      c${code}={}
      function c${code}.initial_effect(c)
        c:${helper}()
      end
      `;
    const session = createDuel({ seed: Number(code), startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [code] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, `c${code}.lua`).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === code)!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:extra-or-type:${summonType}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === `c${code}.lua` ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === code)!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:extra-or-type:${summonType}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, summonType))).toBe(true);
    restoredSource.location = "graveyard";
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it("restores must-first-be-Ritual summon value predicates", () => {
    const cards: DuelCardData[] = [{ code: "902", name: "Must First Ritual Probe", kind: "monster", typeFlags: 0x81 }];
    const reader = createCardReader(cards);
    const script = `
      c902={}
      function c902.initial_effect(c)
        c:AddMustFirstBeRitualSummoned()
      end
      `;
    const session = createDuel({ seed: 432, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["902"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c902.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "902")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:proc-complete-or-type:${luaSummonTypeRitual}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c902.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "902")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:proc-complete-or-type:${luaSummonTypeRitual}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeRitual))).toBe(true);
    restoredSource.customStatusMask = 0x8;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });

  it("restores must-first-be-Pendulum summon value predicates", () => {
    const cards: DuelCardData[] = [{ code: "903", name: "Must First Pendulum Probe", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 }];
    const reader = createCardReader(cards);
    const script = `
      c903={}
      function c903.initial_effect(c)
        c:AddMustFirstBePendulumSummoned()
      end
      `;
    const session = createDuel({ seed: 433, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["903"], extra: [] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c903.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "903")!;
    expect(session.state.effects).toEqual([
      expect.objectContaining({
        code: 30,
        sourceUid: source.uid,
        luaValueDescriptor: `special-summon-condition:proc-complete-or-type:${luaSummonTypePendulum}`,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c903.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    const restoredSource = restored.session.state.cards.find((card) => card.code === "903")!;
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 30 && effect.sourceUid === restoredSource.uid);
    expect(restoredEffect).toMatchObject({ luaValueDescriptor: `special-summon-condition:proc-complete-or-type:${luaSummonTypePendulum}` });
    expect(typeof restoredEffect?.valuePredicate).toBe("function");
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(false);
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypePendulum))).toBe(true);
    restoredSource.customStatusMask = 0x8;
    expect(restoredEffect!.valuePredicate!(valueContext(restored.session.state, restoredSource, luaSummonTypeSpecial))).toBe(true);
  });
});
