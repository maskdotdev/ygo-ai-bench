import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua release summon helpers", () => {
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

  it("preserves active Lua reason source metadata when releasing ritual materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ritual Release Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Ritual Release Material", kind: "monster" },
      { code: "940", name: "Ritual Release Target", kind: "monster", ritualMaterials: ["200"] },
    ];
    const session = createDuel({ seed: 125, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "940"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeTruthy();
    expect(material).toBeTruthy();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local ritual=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 940), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          local materials=Duel.GetRitualMaterial(tp, ritual)
          Debug.Message("release ritual source result " .. Duel.ReleaseRitualMaterial(materials))
          local released=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
          local rc=released:GetReasonCard()
          Debug.Message("release ritual source " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(released:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "release-ritual-material-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);

    expect(host.messages).toContain("release ritual source result 1");
    expect(host.messages).toContain("release ritual source true/true");
    expect(material).toMatchObject({ location: "graveyard", reasonCardUid: source!.uid, reasonEffectId: 1 });
  });

  it("lets Lua scripts check tribute summon availability", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "One Tribute Target", kind: "monster", level: 6 },
      { code: "200", name: "Two Tribute Target", kind: "monster", level: 7 },
      { code: "300", name: "Free Tribute A", kind: "monster" },
      { code: "400", name: "Free Tribute B", kind: "monster" },
      { code: "500", name: "Locked Tribute", kind: "monster" },
      { code: "600", name: "Zone Filler A", kind: "monster" },
      { code: "700", name: "Zone Filler B", kind: "monster" },
    ];
    const session = createDuel({ seed: 39, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    const firstTribute = session.state.cards.find((card) => card.code === "300");
    expect(firstTribute).toBeTruthy();
    moveDuelCard(session.state, firstTribute!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const openZone = host.loadScript(
      `
      local one = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local two = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("tribute counts " .. Duel.GetTributeCount(one) .. "/" .. Duel.GetTributeCount(two) .. "/" .. Duel.GetTributeCount(nil))
      Debug.Message("tribute open zero " .. tostring(Duel.CheckTribute(one, 0, 0, nil)))
      Debug.Message("tribute open one " .. tostring(Duel.CheckTribute(one, 1, 1, nil)))
      local double = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil)
      double:GetFirst():RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("tribute double " .. tostring(Duel.CheckTribute(two, 2, 2, double)) .. "/" .. Duel.SelectTribute(0, two, 2, 2, double):GetCount())
      Debug.Message("tribute double capped " .. tostring(Duel.CheckTribute(two, 1, 1, double)) .. "/" .. Duel.SelectTribute(0, two, 1, 1, double):GetCount())
      double:GetFirst():ResetFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE)
      aux.AddNormalSummonProcedure(two,true,false,1,1,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("tribute proc count " .. Duel.GetTributeCount(two) .. "/" .. tostring(Duel.CheckTribute(two)))
      aux.AddNormalSummonProcedure(two,true,false,0,1,SUMMON_TYPE_TRIBUTE,1235)
      local reduced_min,reduced_max=two:GetTributeRequirement()
      local reduced_selected=Duel.SelectTribute(0,two)
      Debug.Message("tribute reduced proc " .. Duel.GetTributeCount(two) .. "/" .. reduced_min .. "/" .. reduced_max .. "/" .. tostring(Duel.CheckTribute(two)) .. "/" .. reduced_selected:GetCount())
      `,
      "check-tribute-open-zone.lua",
    );
    expect(openZone.ok, openZone.error).toBe(true);

    for (const code of ["400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const setup = host.loadScript(
      `
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UNRELEASABLE_SUM)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "check-tribute-lock.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const fullZone = host.loadScript(
      `
      local one = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local two = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local free = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(300) or tc:IsCode(400) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      local locked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local tribute_group = Duel.GetTributeGroup(one)
      local limited_group = Duel.GetTributeGroup(two, 0, free)
      local locked_group = Duel.GetTributeGroup(one, 0, locked)
      Debug.Message("tribute full zero " .. tostring(Duel.CheckTribute(one, 0, 0, nil)))
      Debug.Message("tribute full one " .. tostring(Duel.CheckTribute(one, 1, 1, nil)))
      Debug.Message("tribute full two " .. tostring(Duel.CheckTribute(two, 2, 2, nil)))
      Debug.Message("tribute limited two " .. tostring(Duel.CheckTribute(two, 2, 2, free)))
      Debug.Message("tribute locked only " .. tostring(Duel.CheckTribute(one, 1, 1, locked)))
      Debug.Message("tribute zone free " .. tostring(Duel.CheckTribute(one, 1, 1, free, 0, 0x1)))
      Debug.Message("tribute zone blocked " .. tostring(Duel.CheckTribute(one, 1, 1, free, 0, 0x4)))
      Debug.Message("tribute group " .. tribute_group:GetCount() .. "/" .. tribute_group:FilterCount(function(c) return c:IsCode(500) end, nil))
      Debug.Message("tribute limited group " .. limited_group:GetCount() .. "/" .. limited_group:FilterCount(function(c) return c:IsCode(300) or c:IsCode(400) end, nil))
      Debug.Message("tribute locked group " .. locked_group:GetCount())
      `,
      "check-tribute-full-zone.lua",
    );

    expect(fullZone.ok, fullZone.error).toBe(true);
    expect(host.messages).toContain("tribute counts 1/2/0");
    expect(host.messages).toContain("tribute open zero true");
    expect(host.messages).toContain("tribute open one true");
    expect(host.messages).toContain("tribute double true/1");
    expect(host.messages).toContain("tribute double capped false/0");
    expect(host.messages).toContain("tribute proc count 1/true");
    expect(host.messages).toContain("tribute reduced proc 0/0/1/true/0");
    expect(host.messages).toContain("tribute full zero false");
    expect(host.messages).toContain("tribute full one true");
    expect(host.messages).toContain("tribute full two true");
    expect(host.messages).toContain("tribute limited two true");
    expect(host.messages).toContain("tribute locked only false");
    expect(host.messages).toContain("tribute zone free true");
    expect(host.messages).toContain("tribute zone blocked false");
    expect(host.messages).toContain("tribute group 4/0");
    expect(host.messages).toContain("tribute limited group 2/2");
    expect(host.messages).toContain("tribute locked group 0");
  });

  it("lets Lua scripts select tribute summon materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "One Tribute Target", kind: "monster", level: 6 },
      { code: "200", name: "Two Tribute Target", kind: "monster", level: 7 },
      { code: "300", name: "Free Tribute A", kind: "monster" },
      { code: "400", name: "Free Tribute B", kind: "monster" },
      { code: "500", name: "Locked Tribute", kind: "monster" },
      { code: "600", name: "Off Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 40, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: ["600"] },
    });
    startDuel(session);
    for (const code of ["300", "400", "500", "600"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const opponentMaterial = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.code === "600");
    expect(opponentMaterial).toBeTruthy();
    moveDuelCard(session.state, opponentMaterial!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UNRELEASABLE_SUM)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "select-tribute-lock.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local one = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local two = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local limited = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(300) or tc:IsCode(400) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      local locked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local selected = Duel.SelectTribute(0, one, 1, 1)
      Debug.Message("selected tribute one " .. selected:GetCount() .. "/" .. selected:GetFirst():GetCode())
      local selected_two = Duel.SelectTribute(0, two, 2, 2, limited)
      Debug.Message("selected tribute two " .. selected_two:GetCount() .. "/" .. selected_two:FilterCount(function(c) return c:IsCode(300) or c:IsCode(400) end, nil))
      local selected_locked = Duel.SelectTribute(0, one, 1, 1, locked)
      Debug.Message("selected tribute locked " .. selected_locked:GetCount())
      local selected_zone = Duel.SelectTribute(0, one, 1, 1, limited, 0, 0x1)
      Debug.Message("selected tribute zone " .. selected_zone:GetCount() .. "/" .. selected_zone:GetFirst():GetCode())
      local selected_zone_blocked = Duel.SelectTribute(0, one, 1, 1, limited, 0, 0x4)
      Debug.Message("selected tribute zone blocked " .. selected_zone_blocked:GetCount())
      local opponent = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 1, LOCATION_MZONE, 0, 1, 1, nil)
      local selected_opponent = Duel.SelectTribute(0, one, 1, 1, opponent, 1)
      Debug.Message("selected tribute opponent " .. selected_opponent:GetCount() .. "/" .. selected_opponent:GetFirst():GetControler())
      `,
      "select-tribute.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("selected tribute one 1/300");
    expect(host.messages).toContain("selected tribute two 2/2");
    expect(host.messages).toContain("selected tribute locked 0");
    expect(host.messages).toContain("selected tribute zone 1/300");
    expect(host.messages).toContain("selected tribute zone blocked 0");
    expect(host.messages).toContain("selected tribute opponent 1/1");
  });

  it("lets Lua scripts check and select release summon materials with zone pressure", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Summon Target", kind: "monster", level: 6 },
      { code: "300", name: "Release Summon A", kind: "monster" },
      { code: "400", name: "Release Summon B", kind: "monster" },
      { code: "500", name: "Release Summon Locked", kind: "monster" },
      { code: "600", name: "Zone Filler A", kind: "monster" },
      { code: "700", name: "Zone Filler B", kind: "monster" },
    ];
    const session = createDuel({ seed: 41, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local filter = function(tc) return tc:IsCode(300) or tc:IsCode(400) end
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("release summon one " .. tostring(Duel.CheckReleaseGroupSummon(target, 0, nil, filter, 1, 1, nil)))
      Debug.Message("release summon excluded miss " .. tostring(Duel.CheckReleaseGroupSummon(target, 0, nil, filter, 2, 2, excluded)))
      local selected = Duel.SelectReleaseGroupSummon(target, 0, nil, filter, 1, 2, nil)
      Debug.Message("release summon selected " .. selected:GetCount() .. "/" .. selected:GetFirst():GetCode() .. "/" .. Duel.GetMZoneCount(0, selected))
      Duel.SetSelectedCard(selected:GetFirst())
      Debug.Message("release summon forced " .. tostring(Duel.CheckReleaseGroupSummon(target, 0, nil, filter, 2, 2, nil)))
      Duel.SetSelectedCard(nil)
      `,
      "release-summon-group.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release summon one true");
    expect(host.messages).toContain("release summon excluded miss false");
    expect(host.messages).toContain("release summon selected 1/300/1");
    expect(host.messages).toContain("release summon forced true");
  });

  it("lets Lua scripts evaluate release summon zone selection checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Summon Target", kind: "monster", level: 6 },
      { code: "300", name: "Must Release", kind: "monster" },
      { code: "400", name: "One Of A", kind: "monster" },
      { code: "500", name: "One Of B", kind: "monster" },
      { code: "600", name: "Zone Filler A", kind: "monster" },
      { code: "700", name: "Zone Filler B", kind: "monster" },
    ];
    const session = createDuel({ seed: 42, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local must = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local oneof = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(400) or tc:IsCode(500) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      local pick_one = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local pick_two = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(400) or tc:IsCode(500) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      local check = aux.ZoneCheckFunc(target,0,0xff)
      local loose = aux.CheckZonesReleaseSummonCheck(must,oneof,check)
      local strict = aux.CheckZonesReleaseSummonCheckSelection(must,oneof,check)
      local ok1,stop1 = loose(pick_one,nil,0,nil)
      local ok2,stop2 = loose(pick_two,nil,0,nil)
      local ok3,stop3 = strict(pick_one,nil,0,nil)
      local with_must = pick_one:Clone()
      with_must:Merge(must)
      local ok4,stop4 = strict(with_must,nil,0,nil)
      Debug.Message("release zone loose " .. tostring(ok1) .. "/" .. tostring(stop1) .. "/" .. tostring(ok2) .. "/" .. tostring(stop2))
      Debug.Message("release zone strict " .. tostring(ok3) .. "/" .. tostring(stop3) .. "/" .. tostring(ok4) .. "/" .. tostring(stop4))
      `,
      "release-summon-zone-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release zone loose true/false/false/true");
    expect(host.messages).toContain("release zone strict false/false/true/false");
  });

});
