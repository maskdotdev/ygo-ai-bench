import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

const preReleaseScript = (code: string): string => fs.readFileSync(`.upstream/ignis/script/pre-release/c${code}.lua`, "utf8");

describe("Lua summon and release helpers", () => {
  it("lets Lua scripts query whether summon selection can be cancelled", () => {
    const session = createDuel({ seed: 156, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("summon cancelable " .. tostring(Duel.IsSummonCancelable()))
      `,
      "summon-cancelable.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon cancelable true");
  });

  it("lets Lua scripts negate summoned cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Summon", kind: "monster" },
      { code: "200", name: "Unsummoned Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 75, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local summoned = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summon before negate " .. Duel.Summon(summoned, true, nil))
      Debug.Message("negate summon " .. Duel.NegateSummon(summoned))
      Debug.Message("negate operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("negate hand " .. Duel.NegateSummon(hand))
      Debug.Message("negate hand operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "negate-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon before negate 1");
    expect(host.messages).toContain("negate summon 1");
    expect(host.messages).toContain("negate operated 1/100");
    expect(host.messages).toContain("negate hand 0");
    expect(host.messages).toContain("negate hand operated 0");
    const negated = session.state.cards.find((card) => card.code === "100");
    const unsummoned = session.state.cards.find((card) => card.code === "200");
    expect(negated).toMatchObject({ location: "graveyard", reason: 0x1000 });
    expect(negated?.summonType).toBeUndefined();
    expect(negated?.summonPlayer).toBeUndefined();
    expect(unsummoned).toMatchObject({ location: "hand" });
  });

  it("lets Lua scripts invoke summon helper APIs", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster", typeFlags: 0x1001 },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Lua Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Lua Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Lua Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Lua Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const cases = [
      { label: "fusion", fn: "FusionSummon", target: "900", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_HAND", extra: ["900"], main: ["100", "300"] },
      { label: "synchro", fn: "SynchroSummon", target: "910", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["910"], main: ["100", "300"], field: true },
      { label: "xyz", fn: "XyzSummon", target: "920", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["920"], main: ["100", "300"], field: true },
      { label: "link", fn: "LinkSummon", target: "930", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["930"], main: ["100", "300"], field: true },
      { label: "ritual", fn: "RitualSummon", target: "940", targetLocation: "LOCATION_HAND", materials: "LOCATION_HAND", main: ["940", "100", "300"] },
    ];

    for (const current of cases) {
      const session = createDuel({ seed: 5, startingHandSize: current.main.length, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: current.main, extra: current.extra ?? [] },
        1: { main: ["100", "300", "100"] },
      });
      startDuel(session);
      if (current.field) {
        for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
          moveDuelCard(session.state, card.uid, "monsterZone", 0);
        }
      }

      const host = createLuaScriptHost(session);
      const result = host.loadScript(
        `
        local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${current.target}), 0, ${current.targetLocation}, 0, 1, 1, nil):GetFirst()
        local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, ${current.materials}, 0, 2, 2, target)
        Debug.Message("${current.label} " .. Duel.${current.fn}(target, materials))
        `,
        `${current.label}-summon.lua`,
      );

      expect(result.ok).toBe(true);
      expect(host.messages).toContain(`${current.label} 1`);
      expect(session.state.cards.find((card) => card.code === current.target)?.location).toBe("monsterZone");
    }
  });

  it("counts selected field materials as freeing zone space for Lua ritual summon helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Ritual Material A", kind: "monster" },
      { code: "200", name: "Field Ritual Material B", kind: "monster" },
      { code: "300", name: "Field Zone Filler A", kind: "monster" },
      { code: "400", name: "Field Zone Filler B", kind: "monster" },
      { code: "500", name: "Field Zone Filler C", kind: "monster" },
      { code: "940", name: "Lua Full Zone Ritual", kind: "monster" },
    ];
    const session = createDuel({ seed: 77, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code !== "940")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local mat_a = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local mat_b = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("full zone ritual " .. Duel.RitualSummon(ritual, Group.FromCards(mat_a, mat_b)))
      `,
      "full-zone-selected-ritual-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("full zone ritual 1");
    expect(session.state.cards.find((card) => card.code === "940")).toMatchObject({ location: "monsterZone", summonType: "ritual" });
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
  });

  it("queues Lua material triggers when summon materials are consumed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Material Trigger", kind: "monster" },
      { code: "300", name: "Lua Material B", kind: "monster" },
      { code: "900", name: "Lua Material Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 57, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, LOCATION_HAND, 0, 2, 2, target)
      local e=Effect.CreateEffect(material)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_BE_MATERIAL)
      e:SetRange(LOCATION_GRAVE)
      e:SetOperation(function(e,tp) Debug.Message("lua material trigger resolved " .. e:GetHandler():GetCode()) end)
      material:RegisterEffect(e)
      Debug.Message("lua material fusion " .. Duel.FusionSummon(target, materials))
      `,
      "lua-material-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("lua material fusion 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("usedAsMaterial");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "usedAsMaterial", eventCode: 1108 }));
    const trigger = getLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua material trigger resolved 100");
  });

  it("queues Lua pre-material triggers before summon materials are consumed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Pre Material Trigger", kind: "monster" },
      { code: "300", name: "Lua Material B", kind: "monster" },
      { code: "900", name: "Lua Pre Material Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 58, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, LOCATION_HAND, 0, 2, 2, target)
      local e=Effect.CreateEffect(material)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_BE_PRE_MATERIAL)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("lua pre material trigger resolved " .. e:GetHandler():GetCode()) end)
      material:RegisterEffect(e)
      Debug.Message("lua pre material fusion " .. Duel.FusionSummon(target, materials))
      `,
      "lua-pre-material-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("lua pre material fusion 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("preUsedAsMaterial");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "preUsedAsMaterial", eventCode: 1109 }));
    const trigger = getLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua pre material trigger resolved 100");
  });

  it("makes Lua optional when material triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material Later Boundary Source", kind: "monster" },
      { code: "500", name: "When Material Later Boundary", kind: "monster" },
      { code: "600", name: "If Material Later Boundary", kind: "monster" },
      { code: "700", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "900", name: "Material Later Boundary Fusion", kind: "extra", fusionMaterials: ["500", "600"] },
    ];
    const session = createDuel({ seed: 59, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500", "600", "700"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local materials=Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(500) or tc:IsCode(600) end, 0, LOCATION_HAND, 0, 2, 2, fusion)
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.FusionSummon(fusion, materials)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_material)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_BE_MATERIAL)
      when_effect:SetRange(LOCATION_GRAVE)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when material resolved")
      end)
      when_material:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_material)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_BE_MATERIAL)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_GRAVE)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if material resolved")
      end)
      if_material:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "material-later-boundary-missed-timing.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1108");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1108", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "usedAsMaterial", eventCode: 1108 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("makes Lua optional when pre-material triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pre Material Later Boundary Source", kind: "monster" },
      { code: "500", name: "When Pre Material Later Boundary", kind: "monster" },
      { code: "600", name: "If Pre Material Later Boundary", kind: "monster" },
      { code: "700", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "900", name: "Pre Material Later Boundary Fusion", kind: "extra", fusionMaterials: ["500", "600"] },
    ];
    const session = createDuel({ seed: 60, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500", "600", "700"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local materials=Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(500) or tc:IsCode(600) end, 0, LOCATION_HAND, 0, 2, 2, fusion)
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.FusionSummon(fusion, materials)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_material)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_BE_PRE_MATERIAL)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when pre material resolved")
      end)
      when_material:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_material)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_BE_PRE_MATERIAL)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if pre material resolved")
      end)
      if_material:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "pre-material-later-boundary-missed-timing.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1109");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1109", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "preUsedAsMaterial", eventCode: 1109 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("makes Lua optional when special-summon-success triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Summon Watcher", kind: "monster" },
      { code: "400", name: "If Summon Watcher", kind: "monster" },
      { code: "500", name: "Summon Later Boundary A", kind: "monster" },
      { code: "600", name: "Summon Later Boundary B", kind: "monster" },
      { code: "700", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "900", name: "Summon Later Boundary Fusion", kind: "extra", fusionMaterials: ["500", "600"] },
    ];
    const session = createDuel({ seed: 61, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500", "600", "700"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local materials=Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(500) or tc:IsCode(600) end, 0, LOCATION_HAND, 0, 2, 2, fusion)
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.FusionSummon(fusion, materials)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_SPSUMMON_SUCCESS)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when summon resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_SPSUMMON_SUCCESS)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if summon resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "special-summon-later-boundary-missed-timing.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1102");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1102", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("lets Lua ritual scripts summon with selected materials when card metadata has no recipe", () => {
    const cards: DuelCardData[] = [
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell", typeFlags: 0x82 },
      { code: "70405001", alias: "101305028", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81, level: 8 },
      { code: "100", name: "Ritual Material A", kind: "monster", level: 4 },
      { code: "300", name: "Ritual Material B", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 61, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["33599853", "70405001", "100", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305044"), "c33599853.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    expect(ritualSpell).toBeTruthy();
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ritualSpell!.uid);
    expect(action).toBeTruthy();
    applyAndAssert(session, action!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.code === "70405001")).toMatchObject({
      location: "monsterZone",
      summonType: "ritual",
      summonMaterialUids: expect.arrayContaining([
        session.state.cards.find((card) => card.code === "100")!.uid,
        session.state.cards.find((card) => card.code === "300")!.uid,
      ]),
    });
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
  });

  it("records event-code metadata for Lua ritual summons with selected materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ritual Material A", kind: "monster", level: 4 },
      { code: "300", name: "Ritual Material B", kind: "monster", level: 4 },
      { code: "500", name: "Ritual Trigger Source", kind: "monster", level: 4 },
      { code: "940", name: "Lua Ritual", kind: "monster", typeFlags: 0x81, level: 8 },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "500");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "lua-ritual-event-code",
      sourceUid: source!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      triggerCode: 1102,
      range: ["hand"],
      operation(ctx) {
        ctx.log("ritual event-code trigger resolved");
      },
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, LOCATION_HAND, 0, 2, 2, ritual)
      Debug.Message("selected ritual " .. Duel.RitualSummon(ritual, materials))
      `,
      "lua-selected-ritual-event-code.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("selected ritual 1");
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "specialSummoned", eventCode: 1102, eventReason: 0x100810, eventReasonPlayer: 0 });
    expect(session.state.pendingTriggers[0]).toMatchObject({ effectId: "lua-ritual-event-code", eventName: "specialSummoned", eventCode: 1102, eventReason: 0x100810, eventReasonPlayer: 0 });
  });

  it("makes earlier Lua optional when triggers miss timing at ritual summon boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ritual Boundary Source", kind: "monster", level: 4 },
      { code: "200", name: "Ritual Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Ritual Boundary Material", kind: "monster", level: 8 },
      { code: "600", name: "Ritual Boundary Watcher", kind: "monster" },
      { code: "940", name: "Ritual Boundary Monster", kind: "monster", typeFlags: 0x81, level: 8 },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500", "600", "940"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil)
      local summon_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ritual=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.RitualSummon(ritual, material)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to grave resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to grave resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local summon_effect=Effect.CreateEffect(summon_watcher)
      summon_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      summon_effect:SetCode(EVENT_SPSUMMON_SUCCESS)
      summon_effect:SetRange(LOCATION_HAND)
      summon_effect:SetOperation(function(e,tp)
        Debug.Message("ritual boundary resolved")
      end)
      summon_watcher:RegisterEffect(summon_effect)
      `,
      "ritual-summon-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1102"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102 })]),
    );
  });

  it("lets Lua scripts register generic Fusion, Synchro, and cost procedure helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Probe", kind: "monster" },
      { code: "200", name: "Discardable", kind: "monster" },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        Fusion.AddProcMixRep(c,true,true,aux.FilterBoolFunctionEx(Card.IsRace,RACE_FIEND),1,99,aux.FilterBoolFunctionEx(Card.IsCode,100))
        Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsRace,RACE_FIEND),2)
        Fusion.AddContactProc(c,function() return Group.CreateGroup() end,function() return true end,function() return true end)
        Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)
        local armor1,armor2,armor3=Armor.AddProcedure(c)
        local magnetic1,magnetic2,magnetic3=PlusMinus.AddMagneticProcedure(c)
        Auxiliary.addLizardCheck(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetCost(Cost.AND(Cost.SoftOncePerChain(id),Cost.Discard()))
        c:RegisterEffect(e)
        local wrapped=Fusion.CheckWithHandler(aux.FALSE)
        Debug.Message("procedure helpers " .. tostring(wrapped(c,{GetHandler=function() return c end})) .. "/" .. tostring(Synchro.NonTuner(nil)(c,c,0,0)))
        Debug.Message("procedure namespaces " .. tostring(aux.FusionProcedure==Fusion) .. "/" .. tostring(aux.RitualProcedure==Ritual) .. "/" .. tostring(aux.SynchroProcedure==Synchro) .. "/" .. tostring(aux.XyzProcedure==Xyz) .. "/" .. tostring(aux.LinkProcedure==Link) .. "/" .. tostring(aux.MaximumProcedure==Maximum))
        Debug.Message("unofficial procedures " .. tostring(aux.ArmorProcedure==Armor) .. "/" .. armor1:GetCode() .. "/" .. armor3:GetCode() .. "/" .. tostring(aux.PlusMinusProcedure==PlusMinus) .. "/" .. magnetic2:GetCode() .. "/" .. magnetic3:GetCode())
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("procedure helpers true/true");
    expect(host.messages).toContain("procedure namespaces true/true/true/true/true/true");
    expect(host.messages).toContain("unofficial procedures true/86/1131/true/191/344");
  });

  it("lets Lua Fusion procedure helpers banish selected materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fusion Banish Material A", kind: "monster" },
      { code: "200", name: "Fusion Banish Material B", kind: "monster" },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local sg = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("fusion banish before " .. sg:GetCount())
      Debug.Message("fusion banish moved " .. Fusion.BanishMaterial(nil,nil,0,sg))
      Debug.Message("fusion banish after " .. sg:GetCount())
      Debug.Message("fusion banish operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "fusion-banish-material.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion banish before 2");
    expect(host.messages).toContain("fusion banish moved 2");
    expect(host.messages).toContain("fusion banish after 0");
    expect(host.messages).toContain("fusion banish operated 2");
    expect(session.state.cards.filter((card) => card.location === "banished").map((card) => card.code).sort()).toEqual(["100", "200"]);
    expect(session.state.cards.filter((card) => card.location === "banished").map((card) => card.reason)).toEqual([0x40048, 0x40048]);
  });

  it("lets Lua Fusion procedure helpers shuffle selected materials into the deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fusion Shuffle Material A", kind: "monster" },
      { code: "200", name: "Fusion Shuffle Material B", kind: "monster" },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local sg = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_GRAVE, 0, nil)
      Debug.Message("fusion shuffle before " .. sg:GetCount())
      Debug.Message("fusion shuffle moved " .. Fusion.ShuffleMaterial(nil,nil,0,sg))
      Debug.Message("fusion shuffle after " .. sg:GetCount())
      Debug.Message("fusion shuffle operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "fusion-shuffle-material.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion shuffle before 2");
    expect(host.messages).toContain("fusion shuffle moved 2");
    expect(host.messages).toContain("fusion shuffle after 0");
    expect(host.messages).toContain("fusion shuffle operated 2");
    expect(session.state.cards.filter((card) => card.location === "deck").map((card) => card.code).sort()).toEqual(["100", "200"]);
    expect(session.state.cards.filter((card) => card.location === "deck").map((card) => card.reason)).toEqual([0x40048, 0x40048]);
  });

  it("lets Lua Fusion procedure filters compose location and material checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Fusion Filter", kind: "monster" },
      { code: "200", name: "Hand Fusion Filter", kind: "monster" },
      { code: "300", name: "Spell Fusion Filter", kind: "spell" },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const fieldMaterial = session.state.cards.find((card) => card.code === "100");
    expect(fieldMaterial).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local onfield = Fusion.OnFieldMat(Card.IsMonster, Card.IsAbleToGrave)
      local inhand = Fusion.InHandMat(Card.IsMonster, Card.IsAbleToGrave)
      local monster = Fusion.IsMonsterFilter(Card.IsAbleToGrave, function(c) return c:IsCode(100) or c:IsCode(200) end)
      local e = Effect.CreateEffect(field)
      Debug.Message("fusion filters field " .. tostring(onfield(field)) .. "/" .. tostring(onfield(hand)) .. "/" .. tostring(monster(field)))
      Debug.Message("fusion filters hand " .. tostring(inhand(hand)) .. "/" .. tostring(inhand(field)) .. "/" .. tostring(monster(hand)))
      Debug.Message("fusion filters spell " .. tostring(inhand(spell)) .. "/" .. tostring(monster(spell)))
      Debug.Message("fusion forced handler " .. Fusion.ForcedHandler(e):GetCode())
      `,
      "fusion-filter-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion filters field true/false/true");
    expect(host.messages).toContain("fusion filters hand true/false/true");
    expect(host.messages).toContain("fusion filters spell false/false");
    expect(host.messages).toContain("fusion forced handler 100");
  });

  it("lets Lua Fusion code procedure helpers store expanded material metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fusion Code Procedure A", kind: "monster" },
      { code: "200", name: "Fusion Code Procedure B", kind: "monster" },
      { code: "300", name: "Fusion Code Procedure C", kind: "monster" },
    ];
    const session = createDuel({ seed: 163, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Fusion.AddProcCode2(target,111,222,true,false)
      local mix2 = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code2 " .. tostring(mix2[1]) .. "/" .. tostring(mix2[2]) .. "/" .. mix2[3] .. "/" .. mix2[4])
      Fusion.AddProcCodeRep(target,333,3,false,true)
      local rep = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code rep " .. tostring(rep[1]) .. "/" .. tostring(rep[2]) .. "/" .. rep[3] .. "/" .. rep[4] .. "/" .. rep[5])
      Fusion.AddProcCodeRep2(target,444,2,4,true,true)
      local rep2 = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code rep2 " .. tostring(rep2[1]) .. "/" .. tostring(rep2[2]) .. "/" .. rep2[3] .. "/" .. rep2[4] .. "/" .. rep2[5])
      Fusion.AddProcCodeFun(target,555,Card.IsMonster,2,true,false)
      local codefun = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code fun " .. tostring(codefun[1]) .. "/" .. tostring(codefun[2]) .. "/" .. codefun[3] .. "/" .. tostring(type(codefun[4])) .. "/" .. tostring(type(codefun[5])))
      Fusion.AddProcFunRep2(target,Card.IsMonster,2,5,true)
      local funrep2 = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion fun rep2 " .. tostring(funrep2[1]) .. "/" .. tostring(funrep2[2]) .. "/" .. tostring(type(funrep2[3])) .. "/" .. funrep2[4] .. "/" .. funrep2[5])
      Fusion.AddProcFunFun(target,Card.IsMonster,Card.IsAbleToGrave,2,false)
      local funfun = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion fun fun " .. tostring(funfun[1]) .. "/" .. tostring(funfun[2]) .. "/" .. tostring(type(funfun[3])) .. "/" .. tostring(type(funfun[4])) .. "/" .. tostring(type(funfun[5])))
      Fusion.AddProcFunFunRep(target,Card.IsMonster,Card.IsAbleToGrave,2,4,true)
      local funfunrep = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion fun funrep " .. tostring(funfunrep[1]) .. "/" .. tostring(funfunrep[2]) .. "/" .. tostring(type(funfunrep[3])) .. "/" .. funfunrep[4] .. "/" .. funfunrep[5] .. "/" .. tostring(type(funfunrep[6])))
      Fusion.AddProcCodeFunRep(target,666,Card.IsMonster,1,3,false,true)
      local codefunrep = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code funrep " .. tostring(codefunrep[1]) .. "/" .. tostring(codefunrep[2]) .. "/" .. tostring(type(codefunrep[3])) .. "/" .. codefunrep[4] .. "/" .. codefunrep[5] .. "/" .. codefunrep[6])
      Fusion.AddProcCode2FunRep(target,777,888,Card.IsMonster,2,6,true,false)
      local code2funrep = target:GetMetatable(false).fusion_materials
      Debug.Message("fusion code2 funrep " .. tostring(code2funrep[1]) .. "/" .. tostring(code2funrep[2]) .. "/" .. tostring(type(code2funrep[3])) .. "/" .. code2funrep[4] .. "/" .. code2funrep[5] .. "/" .. code2funrep[6] .. "/" .. code2funrep[7])
      `,
      "fusion-code-procedure-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion code2 true/false/111/222");
    expect(host.messages).toContain("fusion code rep false/true/333/333/333");
    expect(host.messages).toContain("fusion code rep2 true/true/444/2/4");
    expect(host.messages).toContain("fusion code fun true/false/555/function/function");
    expect(host.messages).toContain("fusion fun rep2 false/true/function/2/5");
    expect(host.messages).toContain("fusion fun fun false/false/function/function/function");
    expect(host.messages).toContain("fusion fun funrep false/true/function/2/4/function");
    expect(host.messages).toContain("fusion code funrep false/true/function/1/3/666");
    expect(host.messages).toContain("fusion code2 funrep true/false/function/2/6/777/888");
  });

  it("lets Lua Fusion contact operations apply label group materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Contact Fusion Target", kind: "monster" },
      { code: "200", name: "Contact Fusion Material A", kind: "monster" },
      { code: "300", name: "Contact Fusion Material B", kind: "monster" },
    ];
    const session = createDuel({ seed: 164, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local materials = Duel.SelectMatchingCard(0, function(c) return c:IsCode(200) or c:IsCode(300) end, 0, LOCATION_HAND, 0, 2, 2, nil)
      local e = Effect.CreateEffect(target)
      e:SetLabelObject(materials)
      local op = Fusion.ContactOp(function(g,tp,c)
        Debug.Message("fusion contact callback " .. g:GetCount() .. "/" .. tp .. "/" .. c:GetCode())
      end)
      op(e,0,Group.CreateGroup(),0,0,nil,0,0,target)
      Debug.Message("fusion contact materials " .. target:GetMaterialCount())
      `,
      "fusion-contact-op.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion contact callback 2/0/100");
    expect(host.messages).toContain("fusion contact materials 2");
    expect(session.state.cards.find((card) => card.code === "100")?.summonMaterialUids).toEqual(
      expect.arrayContaining([
        session.state.cards.find((card) => card.code === "200")!.uid,
        session.state.cards.find((card) => card.code === "300")!.uid,
      ]),
    );
  });

  it("lets Lua scripts register temporary and continuous Lizard checks", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Lizard Probe", kind: "monster" }];
    const session = createDuel({ seed: 158, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local temp = aux.createTempLizardCheck(c, aux.FALSE, RESET_PHASE|PHASE_END, 0x7, 0x8, 2)
      local tr1,tr2 = temp:GetTargetRange()
      local reset,reset_count = temp:GetReset()
      Debug.Message("temp lizard metadata " .. temp:GetCode() .. "/" .. tostring(temp:IsHasType(EFFECT_TYPE_FIELD)) .. "/" .. tr1 .. "/" .. tr2 .. "/" .. reset_count .. "/" .. tostring(temp:GetTarget()(temp,c)))
      local added = aux.addTempLizardCheck(c, 0, aux.TRUE)
      local continuous = aux.createContinuousLizardCheck(c, LOCATION_MZONE, aux.TRUE, 0x1, 0x2)
      local cr1,cr2 = continuous:GetTargetRange()
      Debug.Message("continuous lizard metadata " .. continuous:GetCode() .. "/" .. continuous:GetRange() .. "/" .. cr1 .. "/" .. cr2 .. "/" .. tostring(continuous:GetTarget()(continuous,c)))
      local registered = aux.addContinuousLizardCheck(c, LOCATION_MZONE)
      Debug.Message("lizard registered " .. tostring(added~=nil) .. "/" .. tostring(registered~=nil))
      `,
      "lizard-checks.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("temp lizard metadata 51476410/true/7/8/2/false");
    expect(host.messages).toContain("continuous lizard metadata 51476410/4/1/2/true");
    expect(host.messages).toContain("lizard registered true/true");
  });

  it("lets Lua scripts query legal ritual material candidates", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Aliased Ritual Material", kind: "monster" },
      { code: "200", name: "Off-Recipe Monster", kind: "monster" },
      { code: "300", name: "Field Ritual Material", kind: "monster" },
      { code: "500", name: "Locked Ritual Material", kind: "monster" },
      { code: "600", name: "Material-Code Spell", kind: "spell" },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["101", "300", "500", "600"] },
    ];
    const session = createDuel({ seed: 6, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "200", "500", "600"] },
      1: { main: [] },
    });
    startDuel(session);
    const fieldMaterial = session.state.cards.find((card) => card.code === "300");
    expect(fieldMaterial).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_MATERIAL)
        e:SetRange(LOCATION_HAND)
        c:RegisterEffect(e)
      end
      `,
      "ritual-material-lock.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local materials = Duel.GetRitualMaterial(0, ritual)
      Debug.Message("ritual material count " .. materials:GetCount())
      Debug.Message("ritual material aliases " .. materials:FilterCount(aux.FilterBoolFunction(Card.IsCode, 101), nil))
      Debug.Message("ritual material field " .. materials:FilterCount(aux.FilterBoolFunction(Card.IsCode, 300), nil))
      Debug.Message("ritual material blocked " .. materials:FilterCount(aux.FilterBoolFunction(Card.IsCode, 500), nil))
      Debug.Message("ritual material spell " .. materials:FilterCount(aux.FilterBoolFunction(Card.IsCode, 600), nil))
      `,
      "ritual-material-query.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("ritual material count 2");
    expect(host.messages).toContain("ritual material aliases 1");
    expect(host.messages).toContain("ritual material field 1");
    expect(host.messages).toContain("ritual material blocked 0");
    expect(host.messages).toContain("ritual material spell 0");
  });

});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function passCurrentChain(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  if (!pass) return false;
  applyAndAssert(session, pass);
  return true;
}
