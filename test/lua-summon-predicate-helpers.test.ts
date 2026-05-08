import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon predicate helpers", () => {
  it("checks Lua material predicates against an optional summon target", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Target Material A", kind: "monster", level: 4 },
      { code: "200", name: "Wrong Material", kind: "monster", level: 3 },
      { code: "300", name: "Target Tuner", kind: "monster", typeFlags: 0x1001, level: 2 },
      { code: "500", name: "Too Large Synchro Material", kind: "monster", level: 8 },
      { code: "600", name: "Fielded Link Target", kind: "monster", typeFlags: 0x4000001, level: 2 },
      { code: "700", name: "Fielded Xyz Target", kind: "monster", typeFlags: 0x800001, level: 4 },
      { code: "800", name: "Required Link Material", kind: "monster", level: 4 },
      { code: "900", name: "Target Fusion", kind: "extra", fusionMaterials: ["101"] },
      { code: "910", name: "Target Synchro", kind: "extra", synchroMaterials: { tuner: "300", nonTuners: ["101"] } },
      { code: "920", name: "Target Xyz", kind: "extra", typeFlags: 0x800001, level: 4 },
      { code: "930", name: "Target Link", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "940", name: "Target Ritual", kind: "monster", ritualMaterials: ["101"] },
      { code: "950", name: "Generic Synchro", kind: "extra", typeFlags: 0x2001, level: 6 },
      { code: "960", name: "Specific Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterials: ["101", "800"] },
    ];
    const session = createDuel({ seed: 58, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "500", "600", "700", "800", "940"], extra: ["900", "910", "920", "930", "950", "960"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c300 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c500 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c600 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c700 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c800 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion material pool before " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsOnField,nil))
      local fusion = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      local synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 1)
      local xyz = Duel.GetFieldCard(0, LOCATION_EXTRA, 2)
      local link = Duel.GetFieldCard(0, LOCATION_EXTRA, 3)
      local generic_synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 4)
      local specific_link = Duel.GetFieldCard(0, LOCATION_EXTRA, 5)
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion target material " .. tostring(c100:IsCanBeFusionMaterial(fusion)) .. "/" .. tostring(c200:IsCanBeFusionMaterial(fusion)))
      local selected_fusion_material = Duel.SelectFusionMaterial(0, fusion, Duel.GetFusionMaterial(0), 0)
      Debug.Message("selected fusion material " .. selected_fusion_material:GetCount() .. "/" .. selected_fusion_material:GetFirst():GetCode())
      Duel.SetFusionMaterial(Group.FromCards(c100,c200))
      Debug.Message("set fusion material " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsCode,nil,100) .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsCode,nil,200))
      Debug.Message("fusion self target material " .. tostring(fusion:IsCanBeFusionMaterial(fusion)))
      Debug.Message("ritual target material " .. tostring(c100:IsCanBeRitualMaterial(ritual)) .. "/" .. tostring(c200:IsCanBeRitualMaterial(ritual)))
      Debug.Message("ritual self target material " .. tostring(ritual:IsCanBeRitualMaterial(ritual)))
      Debug.Message("xyz target hand material " .. tostring(c100:IsCanBeXyzMaterial(xyz)))
      Duel.SpecialSummon(c100, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c200, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c300, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c700, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Debug.Message("fusion material pool after " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsOnField,nil))
      Debug.Message("synchro target material " .. tostring(c300:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c200:IsCanBeSynchroMaterial(synchro)))
      Debug.Message("generic synchro target material " .. tostring(c100:IsCanBeSynchroMaterial(generic_synchro)) .. "/" .. tostring(c300:IsCanBeSynchroMaterial(generic_synchro)) .. "/" .. tostring(c500:IsCanBeSynchroMaterial(generic_synchro)))
      Debug.Message("synchro summonable " .. tostring(synchro:IsSynchroSummonable()) .. "/" .. tostring(synchro:IsSynchroSummonable(c300)) .. "/" .. tostring(synchro:IsSynchroSummonable(c200)))
      Debug.Message("generic synchro summonable " .. tostring(generic_synchro:IsSynchroSummonable(nil, Group.FromCards(c100, c300))) .. "/" .. tostring(generic_synchro:IsSynchroSummonable(nil, Group.FromCards(c100, c200))))
      Debug.Message("xyz summonable " .. tostring(xyz:IsXyzSummonable()) .. "/" .. tostring(xyz:IsXyzSummonable(c100)) .. "/" .. tostring(xyz:IsXyzSummonable(c200)))
      Duel.SendtoGrave(c200, REASON_EFFECT)
      Duel.SendtoGrave(c300, REASON_EFFECT)
      Duel.SpecialSummon(c600, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c800, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Debug.Message("xyz target field material " .. tostring(c100:IsCanBeXyzMaterial(xyz)) .. "/" .. tostring(c200:IsCanBeXyzMaterial(xyz)))
      Debug.Message("fielded xyz target material " .. tostring(c100:IsCanBeXyzMaterial(c700)) .. "/" .. tostring(c700:IsCanBeXyzMaterial(c700)))
      Debug.Message("fielded xyz summonable " .. tostring(c700:IsXyzSummonable(nil, Group.FromCards(c100, c700))) .. "/" .. tostring(c700:IsXyzSummonable(nil, Group.FromCards(c100, c200))))
      Debug.Message("link target material " .. tostring(c100:IsCanBeLinkMaterial(link)) .. "/" .. tostring(link:IsCanBeLinkMaterial(link)))
      Debug.Message("fielded link target material " .. tostring(c100:IsCanBeLinkMaterial(c600)) .. "/" .. tostring(c600:IsCanBeLinkMaterial(c600)))
      Debug.Message("link summonable " .. tostring(link:IsLinkSummonable()) .. "/" .. tostring(link:IsLinkSummonable(c100)) .. "/" .. tostring(link:IsLinkSummonable(nil, Group.FromCards(c100), 2, 2)))
      Debug.Message("specific link summonable " .. tostring(specific_link:IsLinkSummonable(nil, Group.FromCards(c100,c800), 2, 2)) .. "/" .. tostring(specific_link:IsLinkSummonable(c800, Group.FromCards(c100,c200), 2, 2)))
      `,
      "target-material-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion target material true/false");
    expect(host.messages).toContain("selected fusion material 1/100");
    expect(host.messages).toContain("set fusion material 2/1/1");
    expect(host.messages).toContain("fusion self target material false");
    expect(host.messages).toContain("ritual target material true/false");
    expect(host.messages).toContain("ritual self target material false");
    expect(host.messages).toContain("fusion material pool before 8/0");
    expect(host.messages).toContain("xyz target hand material false");
    expect(host.messages).toContain("synchro target material true/false");
    expect(host.messages).toContain("generic synchro target material true/true/false");
    expect(host.messages).toContain("synchro summonable true/true/false");
    expect(host.messages).toContain("generic synchro summonable true/false");
    expect(host.messages).toContain("xyz target field material true/false");
    expect(host.messages).toContain("fusion material pool after 2/2");
    expect(host.messages).toContain("xyz summonable true/true/false");
    expect(host.messages).toContain("fielded xyz target material true/false");
    expect(host.messages).toContain("fielded xyz summonable false/false");
    expect(host.messages).toContain("link target material true/false");
    expect(host.messages).toContain("fielded link target material true/false");
    expect(host.messages).toContain("link summonable true/true/false");
    expect(host.messages).toContain("specific link summonable true/false");
  });

  it("requires the explicit Lua Synchro tuner material to be a Tuner", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Non-Tuner With Tuner Code", kind: "monster", typeFlags: 0x1 },
      { code: "300", name: "Explicit Non-Tuner", kind: "monster", typeFlags: 0x1 },
      { code: "910", name: "Role-Specific Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
    ];
    const session = createDuel({ seed: 59, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: [] },
    });
    startDuel(session);

    const nonTunerWithTunerCode = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const explicitNonTuner = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(nonTunerWithTunerCode).toBeDefined();
    expect(explicitNonTuner).toBeDefined();
    moveDuelCard(session.state, nonTunerWithTunerCode!.uid, "monsterZone", 0);
    moveDuelCard(session.state, explicitNonTuner!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c100 = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local c300 = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("role synchro target material " .. tostring(c100:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c300:IsCanBeSynchroMaterial(synchro)))
      Debug.Message("role synchro summonable " .. tostring(synchro:IsSynchroSummonable()) .. "/" .. tostring(synchro:IsSynchroSummonable(c100)) .. "/" .. tostring(synchro:IsSynchroSummonable(c300)))
      `,
      "role-specific-synchro-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("role synchro target material false/true");
    expect(host.messages).toContain("role synchro summonable false/false/false");
  });

  it("checks Lua reincarnation ritual material filters", () => {
    const cards: DuelCardData[] = [
      { code: "940", name: "Reincarnation Material", kind: "monster" },
      { code: "941", name: "Wrong Reincarnation Material", kind: "monster" },
      { code: "950", name: "Reincarnation Ritual", kind: "monster", typeFlags: 0x81 },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "941", "950"] },
      1: { main: ["940"] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const wrong = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "941");
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "940");
    expect(material).toBeDefined();
    expect(wrong).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    moveDuelCard(session.state, wrong!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local rc = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local wrong = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local opponent = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      Debug.Message("reincarnation ritual " .. tostring(aux.ReincarnationRitualFilter(material, rc, 940, 0)) .. "/" .. tostring(aux.ReincarnationRitualFilter(wrong, rc, 940, 0)) .. "/" .. tostring(aux.ReincarnationRitualFilter(opponent, rc, 940, 0)))
      `,
      "reincarnation-ritual-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("reincarnation ritual true/false/false");
  });

  it("counts selected field materials as freeing zone space for Lua extra deck summon predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Full Zone Tuner", kind: "monster", typeFlags: 0x1001, level: 2 },
      { code: "200", name: "Full Zone Non-Tuner", kind: "monster", level: 4 },
      { code: "300", name: "Full Zone Xyz Material", kind: "monster", level: 4 },
      { code: "400", name: "Full Zone Link Material A", kind: "monster", level: 4 },
      { code: "500", name: "Full Zone Link Material B", kind: "monster", level: 4 },
      { code: "910", name: "Full Zone Synchro", kind: "extra", typeFlags: 0x2001, level: 6 },
      { code: "920", name: "Full Zone Xyz", kind: "extra", typeFlags: 0x800001, level: 4 },
      { code: "930", name: "Full Zone Link", kind: "extra", typeFlags: 0x4000001, level: 2 },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"], extra: ["910", "920", "930"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local tuner = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local non_tuner = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local xyz_material = Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      local link_a = Duel.GetFieldCard(0, LOCATION_MZONE, 3)
      local link_b = Duel.GetFieldCard(0, LOCATION_MZONE, 4)
      local synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      local xyz = Duel.GetFieldCard(0, LOCATION_EXTRA, 1)
      local link = Duel.GetFieldCard(0, LOCATION_EXTRA, 2)
      Debug.Message("full zone lua synchro " .. tostring(synchro:IsSynchroSummonable(nil, Group.FromCards(tuner, non_tuner))))
      Debug.Message("full zone lua xyz " .. tostring(xyz:IsXyzSummonable(nil, Group.FromCards(non_tuner, xyz_material))))
      Debug.Message("full zone lua link " .. tostring(link:IsLinkSummonable(nil, Group.FromCards(link_a, link_b), 2, 2)))
      `,
      "full-zone-extra-deck-summon-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("full zone lua synchro true");
    expect(host.messages).toContain("full zone lua xyz true");
    expect(host.messages).toContain("full zone lua link true");
  });

  it("checks Lua card summon predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summonable Monster", kind: "monster", level: 4 },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Tribute Monster", kind: "monster", level: 7 },
      { code: "400", name: "Extra Deck Monster", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "500", name: "Fixture Trap", kind: "trap", typeFlags: 0x4 },
      { code: "600", name: "Zone Filler A", kind: "monster" },
      { code: "700", name: "Zone Filler B", kind: "monster" },
      { code: "800", name: "Zone Filler C", kind: "monster" },
      { code: "810", name: "Zone Filler D", kind: "monster" },
      { code: "820", name: "Zone Filler E", kind: "monster" },
      { code: "830", name: "Set Filler A", kind: "spell", typeFlags: 0x2 },
      { code: "840", name: "Set Filler B", kind: "spell", typeFlags: 0x2 },
      { code: "850", name: "Set Filler C", kind: "spell", typeFlags: 0x2 },
      { code: "860", name: "Set Filler D", kind: "spell", typeFlags: 0x2 },
      { code: "870", name: "Set Filler E", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 87, startingHandSize: 14, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "500", "600", "700", "800", "810", "820", "830", "840", "850", "860", "870"], extra: ["400"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local normal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local extra = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("summonable predicates " .. tostring(normal:IsSummonableCard()) .. "/" .. tostring(spell:IsSummonableCard()) .. "/" .. tostring(tribute:IsSummonableCard()))
      Debug.Message("hand cost predicates " .. tostring(normal:IsAbleToHandAsCost()) .. "/" .. tostring(spell:IsAbleToHandAsCost()) .. "/" .. tostring(extra:IsAbleToHandAsCost()))
      Debug.Message("summon or set predicates " .. tostring(normal:CanSummonOrSet()) .. "/" .. tostring(spell:CanSummonOrSet()) .. "/" .. tostring(tribute:CanSummonOrSet()) .. "/" .. tostring(normal:IsSummonable()))
      Debug.Message("special summonable predicates " .. tostring(normal:IsSpecialSummonable()) .. "/" .. tostring(spell:IsSpecialSummonable()) .. "/" .. tostring(extra:IsSpecialSummonable()))
      Debug.Message("setable predicates " .. tostring(normal:IsMSetable()) .. "/" .. tostring(spell:IsMSetable()) .. "/" .. tostring(tribute:IsMSetable()) .. "/" .. tostring(normal:IsSSetable()) .. "/" .. tostring(spell:IsSSetable()) .. "/" .. tostring(trap:IsSSetable()))
      `,
      "card-summon-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summonable predicates true/false/false");
    expect(host.messages).toContain("hand cost predicates false/false/true");
    expect(host.messages).toContain("summon or set predicates true/false/false/true");
    expect(host.messages).toContain("special summonable predicates true/false/false");
    expect(host.messages).toContain("setable predicates true/false/false/false/true/true");

    session.state.players[0].normalSummonAvailable = false;
    const countHost = createLuaScriptHost(session);
    const countResult = countHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("count blocked predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:IsMSetable()))
      Debug.Message("count ignored predicates " .. tostring(tribute:IsSummonableCard(true)) .. "/" .. tostring(tribute:IsMSetable(true)) .. "/" .. tostring(tribute:CanSummonOrSet(true)))
      `,
      "card-summon-predicate-count-block.lua",
    );
    expect(countResult.ok, countResult.error).toBe(true);
    expect(countHost.messages).toContain("count blocked predicates false/false");
    expect(countHost.messages).toContain("count ignored predicates false/false/false");
    session.state.players[0].normalSummonAvailable = true;

    for (const code of ["600", "700"]) {
      const tributeMaterial = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(tributeMaterial).toBeDefined();
      moveDuelCard(session.state, tributeMaterial!.uid, "monsterZone", 0);
    }
    session.state.players[0].normalSummonAvailable = false;
    const tributeHost = createLuaScriptHost(session);
    const tributeResult = tributeHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("tribute predicate count ignored " .. tostring(tribute:IsSummonable(true,nil,1)) .. "/" .. tostring(tribute:CanSummonOrSet(true,nil,1)))
      `,
      "card-tribute-predicate-count-block.lua",
    );
    expect(tributeResult.ok, tributeResult.error).toBe(true);
    expect(tributeHost.messages).toContain("tribute predicate count ignored true/true");
    session.state.players[0].normalSummonAvailable = true;

    const procHost = createLuaScriptHost(session);
    const procResult = procHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      aux.AddNormalSummonProcedure(tribute,true,false,1,1,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("tribute proc predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:CanSummonOrSet()))
      `,
      "card-tribute-procedure-predicates.lua",
    );
    expect(procResult.ok, procResult.error).toBe(true);
    expect(procHost.messages).toContain("tribute proc predicates true/true");

    for (const code of ["800", "810", "820"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const zoneHost = createLuaScriptHost(session);
    const zoneResult = zoneHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("mzone filled predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:IsMSetable()) .. "/" .. tostring(tribute:IsSpecialSummonable()))
      `,
      "card-summon-predicate-mzone-block.lua",
    );
    expect(zoneResult.ok, zoneResult.error).toBe(true);
    expect(zoneHost.messages).toContain("mzone filled predicates true/true/false");

    for (const code of ["830", "840", "850", "860", "870"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
    }
    const spellTrapHost = createLuaScriptHost(session);
    const spellTrapResult = spellTrapHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("szone blocked predicates " .. tostring(spell:IsSSetable()) .. "/" .. tostring(trap:IsSSetable()))
      `,
      "card-summon-predicate-szone-block.lua",
    );
    expect(spellTrapResult.ok, spellTrapResult.error).toBe(true);
    expect(spellTrapHost.messages).toContain("szone blocked predicates false/false");
  });

  it("uses Lua summon predicate tribute minimum overrides", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Override Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Override Tribute Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 188, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(material).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon min override " .. tostring(tribute:IsSummonable(true,nil,1)) .. "/" .. tostring(tribute:IsSummonable(true,nil,2)) .. "/" .. tostring(tribute:CanSummonOrSet(true,nil,1)))
      `,
      "card-summon-min-override.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon min override true/false/true");
  });

  it("checks Lua player summon legality with tribute metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Player Tribute Material", kind: "monster", level: 4 },
      { code: "300", name: "Player Normal Target", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal_target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player normal typed " .. tostring(Duel.IsPlayerCanSummon(0,SUMMON_TYPE_NORMAL,normal_target)) .. "/" .. tostring(Duel.IsPlayerCanSummon(0,SUMMON_TYPE_TRIBUTE,normal_target)))
      Debug.Message("player tribute missing " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      Debug.Message("player tribute overload missing " .. tostring(Duel.IsPlayerCanSummon(0,SUMMON_TYPE_TRIBUTE,target)))
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(material,0,0,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("player tribute natural missing " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      aux.AddNormalSummonProcedure(target,true,false,1,1,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("player tribute proc ready " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      Debug.Message("player tribute overload ready " .. tostring(Duel.IsPlayerCanSummon(0,SUMMON_TYPE_TRIBUTE,target)))
      `,
      "player-tribute-summon-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player normal typed true/false");
    expect(host.messages).toContain("player tribute missing false");
    expect(host.messages).toContain("player tribute overload missing false");
    expect(host.messages).toContain("player tribute natural missing false");
    expect(host.messages).toContain("player tribute proc ready true");
    expect(host.messages).toContain("player tribute overload ready true");
  });

  it("checks Lua player summon legality with raised tribute metadata and double tribute units", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Raised Tribute Target", kind: "monster", level: 5 },
      { code: "200", name: "Player Double Tribute Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(material,0,0,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("player raised natural " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      aux.AddNormalSummonProcedure(target,true,false,2,2,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("player raised one unit " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      material:RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("player raised double unit " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      `,
      "player-raised-double-tribute-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player raised natural true");
    expect(host.messages).toContain("player raised one unit false");
    expect(host.messages).toContain("player raised double unit true");
  });

  it("checks Lua player monster set legality with tribute materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Tribute Set Target", kind: "monster", level: 5 },
      { code: "200", name: "Player Plain Set Target", kind: "monster", level: 4 },
      { code: "300", name: "Set Material A", kind: "monster", level: 4 },
      { code: "400", name: "Set Material B", kind: "monster", level: 4 },
      { code: "500", name: "Set Material C", kind: "monster", level: 4 },
      { code: "600", name: "Set Material D", kind: "monster", level: 4 },
      { code: "700", name: "Set Material E", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["300", "400", "500", "600", "700"]) {
      const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local tribute_target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local plain_target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player mset full " .. tostring(Duel.IsPlayerCanMSet(0, plain_target)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, tribute_target)))
      session_result = Duel.IsPlayerCanMSet(0, tribute_target, true)
      Debug.Message("player mset ignore count " .. tostring(session_result))
      `,
      "player-tribute-set-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player mset full false/true");
    expect(host.messages).toContain("player mset ignore count true");
  });

});
