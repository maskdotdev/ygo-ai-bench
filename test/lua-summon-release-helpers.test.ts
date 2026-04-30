import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon and release helpers", () => {
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

  it("lets Lua scripts invoke scaffolded summon helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
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

  it("lets Lua scripts release ritual materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Ritual Material", kind: "monster" },
      { code: "300", name: "Field Ritual Material", kind: "monster" },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 86, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const fieldMaterial = session.state.cards.find((card) => card.code === "300");
    expect(fieldMaterial).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local materials = Duel.GetRitualMaterial(0, ritual)
      Debug.Message("release ritual material " .. Duel.ReleaseRitualMaterial(materials))
      Debug.Message("release ritual operated " .. Duel.GetOperatedGroup():GetCount())
      local hand_mat = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local field_mat = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("release ritual hand previous " .. tostring(hand_mat:IsPreviousLocation(LOCATION_HAND)))
      Debug.Message("release ritual field previous " .. tostring(field_mat:IsPreviousLocation(LOCATION_MZONE)))
      Debug.Message("release ritual reason " .. tostring(hand_mat:IsReason(REASON_RELEASE)) .. "/" .. tostring(hand_mat:IsReason(REASON_MATERIAL)) .. "/" .. tostring(hand_mat:IsReason(REASON_RITUAL)))
      `,
      "release-ritual-material.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release ritual material 2");
    expect(host.messages).toContain("release ritual operated 2");
    expect(host.messages).toContain("release ritual hand previous true");
    expect(host.messages).toContain("release ritual field previous true");
    expect(host.messages).toContain("release ritual reason true/true/true");
    expect(session.state.cards.filter((card) => card.location === "graveyard" && (card.code === "100" || card.code === "300"))).toHaveLength(2);
  });

  it("lets Lua scripts check, select, and release monster-zone groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release A", kind: "monster" },
      { code: "300", name: "Release B", kind: "monster" },
      { code: "500", name: "Release C", kind: "monster" },
    ];
    const session = createDuel({ seed: 8, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["100", "300", "500"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc) return tc:IsCode(100) or tc:IsCode(300) end
      local vararg_filter = function(tc, mincode) return tc:GetCode() >= mincode end
      Debug.Message("release group " .. Duel.GetReleaseGroup(0, filter, nil):GetCount())
      Debug.Message("release group count " .. Duel.GetReleaseGroupCount(0, filter, nil))
      Debug.Message("release group vararg " .. Duel.GetReleaseGroup(0, vararg_filter, nil, 300):GetCount())
      Debug.Message("release group count vararg " .. Duel.GetReleaseGroupCount(0, vararg_filter, nil, 300))
      Debug.Message("can release two " .. tostring(Duel.CheckReleaseGroup(0, filter, 2, nil)))
      Debug.Message("can release three " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      Debug.Message("can release ex two " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 2, 2, nil)))
      Debug.Message("can release ex three " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 3, 3, nil)))
      local gx = Duel.SelectReleaseGroupEx(0, filter, 1, 1, nil)
      Debug.Message("selected releases ex " .. gx:GetCount())
      local g = Duel.SelectReleaseGroup(0, filter, 1, 2, nil)
      Debug.Message("selected releases " .. g:GetCount())
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("release group excluded " .. Duel.GetReleaseGroup(0, aux.TRUE, excluded):GetCount())
      Debug.Message("group excluded release check " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 3, excluded)))
      Debug.Message("group excluded release selected " .. Duel.SelectReleaseGroup(0, aux.TRUE, 1, 3, excluded):GetCount())
      local forced = excluded:GetFirst()
      Duel.SetSelectedCard(forced)
      Debug.Message("forced release check " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      local forced_group = Duel.SelectReleaseGroup(0, filter, 1, 3, nil)
      Debug.Message("forced release selected " .. forced_group:GetCount() .. " " .. tostring(forced_group:IsContains(forced)))
      Duel.SetSelectedCard(Group.FromCards(forced, g:GetFirst()))
      Debug.Message("forced release ex max miss " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 1, 1, nil)))
      Duel.SetSelectedCard(nil)
      Debug.Message("released " .. Duel.Release(g, REASON_COST))
      local released = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("previous location " .. tostring(released:IsPreviousLocation(LOCATION_MZONE)))
      Debug.Message("previous controller " .. tostring(released:IsPreviousControler(0)))
      Debug.Message("release reason " .. tostring(released:IsReason(REASON_RELEASE)) .. "/" .. tostring(released:IsReason(REASON_COST)))
      `,
      "release-group.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("release group 2");
    expect(host.messages).toContain("release group count 2");
    expect(host.messages).toContain("release group vararg 2");
    expect(host.messages).toContain("release group count vararg 2");
    expect(host.messages).toContain("can release two true");
    expect(host.messages).toContain("can release three false");
    expect(host.messages).toContain("can release ex two true");
    expect(host.messages).toContain("can release ex three false");
    expect(host.messages).toContain("selected releases ex 1");
    expect(host.messages).toContain("selected releases 2");
    expect(host.messages).toContain("release group excluded 2");
    expect(host.messages).toContain("group excluded release check false");
    expect(host.messages).toContain("group excluded release selected 2");
    expect(host.messages).toContain("forced release check true");
    expect(host.messages).toContain("forced release selected 3 true");
    expect(host.messages).toContain("forced release ex max miss false");
    expect(host.messages).toContain("released 2");
    expect(host.messages).toContain("previous location true");
    expect(host.messages).toContain("previous controller true");
    expect(host.messages).toContain("release reason true/true");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "graveyard" && (card.code === "100" || card.code === "300"))).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "500")?.location).toBe("monsterZone");
  });

  it("lets Lua scripts check and select release cost groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Field A", kind: "monster" },
      { code: "300", name: "Cost Field B", kind: "monster" },
      { code: "500", name: "Cost Hand", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc, mincode) return tc:GetCode() >= mincode end
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("cost check field two " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 2, 2, false, nil, nil, 100)))
      Debug.Message("cost check hand miss " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, false, nil, nil, 100)))
      Debug.Message("cost check hand ok " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, true, nil, nil, 100)))
      Debug.Message("cost excluded " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, true, nil, excluded, 100)))
      local g = Duel.SelectReleaseGroupCost(0, filter, 1, 3, true, nil, nil, 100)
      Debug.Message("cost selected " .. g:GetCount())
      Debug.Message("cost contains hand " .. tostring(g:IsExists(Card.IsLocation, 1, nil, LOCATION_HAND)))
      `,
      "release-cost-group.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("cost check field two true");
    expect(host.messages).toContain("cost check hand miss false");
    expect(host.messages).toContain("cost check hand ok true");
    expect(host.messages).toContain("cost excluded false");
    expect(host.messages).toContain("cost selected 3");
    expect(host.messages).toContain("cost contains hand true");
  });

  it("excludes unreleasable cards from Lua release group helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Unreleasable Cost", kind: "monster" },
      { code: "300", name: "Releasable Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 81, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UNRELEASABLE_NONSUM)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "unreleasable-release-helper.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      Debug.Message("release check two " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 2, nil)))
      Debug.Message("release check one " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 1, nil)))
      local selected = Duel.SelectReleaseGroup(0, aux.TRUE, 1, 2, nil)
      Debug.Message("release selected " .. selected:GetCount())
      Debug.Message("release selected blocked " .. tostring(selected:IsExists(aux.FilterBoolFunction(Card.IsCode, 100), 1, nil)))
      local both = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_MZONE, 0, 1, 2, nil)
      Debug.Message("release moved " .. Duel.Release(both, REASON_COST))
      `,
      "unreleasable-release-helper-run.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release check two false");
    expect(host.messages).toContain("release check one true");
    expect(host.messages).toContain("release selected 1");
    expect(host.messages).toContain("release selected blocked false");
    expect(host.messages).toContain("release moved 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
  });
});
