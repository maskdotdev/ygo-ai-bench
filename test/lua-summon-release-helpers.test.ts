import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

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

  it("lets Lua ritual scripts summon with selected materials when card metadata has no recipe", () => {
    const cards: DuelCardData[] = [
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell", typeFlags: 0x82 },
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81, level: 8 },
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
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c33599853.lua", "utf8"), "c33599853.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    expect(ritualSpell).toBeTruthy();
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ritualSpell!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
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
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local field = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can release player " .. tostring(Duel.IsPlayerCanRelease(0)))
      Debug.Message("can release field " .. tostring(Duel.IsPlayerCanRelease(0, field)))
      Debug.Message("can release hand " .. tostring(Duel.IsPlayerCanRelease(1, hand)))
      Debug.Message("release group " .. Duel.GetReleaseGroup(0, filter, nil):GetCount())
      Debug.Message("release group count " .. Duel.GetReleaseGroupCount(0, filter, nil))
      Debug.Message("release group vararg " .. Duel.GetReleaseGroup(0, vararg_filter, nil, 300):GetCount())
      Debug.Message("release group count vararg " .. Duel.GetReleaseGroupCount(0, vararg_filter, nil, 300))
      local releasable, excluded_release = Duel.GetReleaseGroup(0):Split(aux.ReleaseCostFilter, nil, 0)
      Debug.Message("release cost split " .. releasable:GetCount() .. "/" .. excluded_release:GetCount())
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
    expect(host.messages).toContain("can release player true");
    expect(host.messages).toContain("can release field true");
    expect(host.messages).toContain("can release hand false");
    expect(host.messages).toContain("release group 2");
    expect(host.messages).toContain("release group count 2");
    expect(host.messages).toContain("release group vararg 2");
    expect(host.messages).toContain("release group count vararg 2");
    expect(host.messages).toContain("release cost split 3/0");
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

  it("lets Lua release cost checks use aux release predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Cost A", kind: "monster" },
      { code: "300", name: "Release Cost B", kind: "monster" },
      { code: "500", name: "Release Cost C", kind: "monster" },
      { code: "700", name: "Release Cost D", kind: "monster" },
      { code: "900", name: "Release Cost E", kind: "monster" },
      { code: "1100", name: "Target Group Card", kind: "monster" },
      { code: "1300", name: "Extra Zone Check Card", kind: "extra" },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "700", "900", "1100"], extra: ["1300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300", "500", "700", "900"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1300), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("release check mmz " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckMMZ, nil)))
      local mmz_group = Duel.SelectReleaseGroupCost(0, nil, 1, 1, false, aux.ReleaseCheckMMZ, nil)
      Debug.Message("release select mmz " .. mmz_group:GetCount() .. "/" .. Duel.GetMZoneCount(0, mmz_group))
      Debug.Message("release check target hit " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckTarget, nil, target)))
      Debug.Message("release check target miss " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckTarget, nil, mmz_group)))
      local hand_check = aux.ZoneCheckFunc(target:GetFirst(),0,0)
      local extra_check = aux.ZoneCheckFunc(extra,0,0)
      Debug.Message("zone check func " .. hand_check(mmz_group) .. "/" .. extra_check(mmz_group))
      `,
      "release-cost-aux-checks.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release check mmz true");
    expect(host.messages).toContain("release select mmz 1/1");
    expect(host.messages).toContain("release check target miss false");
    expect(host.messages).toContain("release check target hit true");
    expect(host.messages).toContain("zone check func 1/1");
  });

  it("lets Lua scripts identify opponent extra non-summon release effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Own Release Candidate", kind: "monster" },
      { code: "200", name: "Opponent Numeric Release", kind: "monster" },
      { code: "300", name: "Opponent Zero Release", kind: "monster" },
      { code: "400", name: "Opponent Function Release", kind: "monster" },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300", "400"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local own = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local numeric = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local zero = Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local function_card = Duel.GetFieldCard(1, LOCATION_MZONE, 2)
      local current = Effect.CreateEffect(own)
      local numeric_effect = Effect.CreateEffect(numeric)
      numeric_effect:SetType(EFFECT_TYPE_SINGLE)
      numeric_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      numeric_effect:SetValue(1)
      numeric:RegisterEffect(numeric_effect)
      local zero_effect = Effect.CreateEffect(zero)
      zero_effect:SetType(EFFECT_TYPE_SINGLE)
      zero_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      zero_effect:SetValue(0)
      zero:RegisterEffect(zero_effect)
      local function_effect = Effect.CreateEffect(function_card)
      function_effect:SetType(EFFECT_TYPE_SINGLE)
      function_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      function_effect:SetValue(function(e,ce,reason,tp) return ce==current and reason==REASON_COST and tp==0 end)
      function_card:RegisterEffect(function_effect)
      Debug.Message("release nonsum " .. tostring(aux.ReleaseNonSumCheck(own,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(numeric,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(zero,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(function_card,0,current)))
      Debug.Message("release nonsum wrong player " .. tostring(aux.ReleaseNonSumCheck(function_card,1,current)))
      `,
      "release-nonsum-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release nonsum false/true/false/true");
    expect(host.messages).toContain("release nonsum wrong player false");
  });

  it("lets Lua scripts collect must-be material effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Synchro Must Material", kind: "monster" },
      { code: "300", name: "Function Must Material", kind: "monster" },
      { code: "900", name: "Summon Candidate", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "900"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_MUST_BE_MATERIAL)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(REASON_SYNCHRO)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_MUST_BE_MATERIAL)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(function(te,eg,sump,sc,g)
          if sump==0 and sc and sc:IsCode(900) then return REASON_FUSION end
          return 0
        end)
        c:RegisterEffect(e)
      end
      `,
      "must-be-material-effects.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const result = host.loadScript(
      `
      local sc = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local synchro = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_SYNCHRO)
      local fusion = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_FUSION)
      local ritual = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_RITUAL)
      Debug.Message("must material synchro " .. synchro:GetCount() .. "/" .. tostring(synchro:GetFirst():IsCode(100)))
      Debug.Message("must material fusion " .. fusion:GetCount() .. "/" .. tostring(fusion:GetFirst():IsCode(300)))
      Debug.Message("must material ritual " .. ritual:GetCount())
      `,
      "must-be-material-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("must material synchro 1/true");
    expect(host.messages).toContain("must material fusion 1/true");
    expect(host.messages).toContain("must material ritual 0");
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
