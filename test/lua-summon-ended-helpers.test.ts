import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua ended summon helpers", () => {
  it("keeps basic summon helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Summon", kind: "monster" },
      { code: "200", name: "Ended Set", kind: "monster" },
      { code: "300", name: "Ended Spell Set", kind: "spell" },
    ];
    const session = createDuel({ seed: 224, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local summon = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local set_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local set_spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.IncreaseSummonedCount(0)
      Debug.Message("ended summon " .. Duel.Summon(summon, true, nil))
      Debug.Message("ended mset " .. Duel.MSet(set_monster, true, nil))
      Debug.Message("ended sset " .. Duel.SSet(set_spell))
      Debug.Message("ended summon or set " .. Duel.SummonOrSet(0, summon, true, nil))
      Debug.Message("ended operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-basic-summons.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["ended summon 0", "ended mset 0", "ended sset 0", "ended summon or set 0", "ended operated 0"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.players[0].normalSummonAvailable).toBe(true);
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "hand" });
  });

  it("keeps special summon helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Special", kind: "monster" },
      { code: "200", name: "Ended Material A", kind: "monster" },
      { code: "300", name: "Ended Material B", kind: "monster" },
      { code: "900", name: "Ended Fusion", kind: "extra", fusionMaterials: ["200", "300"] },
    ];
    const session = createDuel({ seed: 225, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((card) => card.code === "100");
    expect(summoned).toBeDefined();
    specialSummonDuelCard(session.state, summoned!.uid, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local summoned = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local material_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("ended step " .. tostring(Duel.SpecialSummonStep(material_a, 0, 0, 0, false, false, POS_FACEUP_ATTACK)))
      Debug.Message("ended complete " .. Duel.SpecialSummonComplete())
      Debug.Message("ended fusion " .. Duel.FusionSummon(fusion, Group.FromCards(material_a, material_b)))
      Debug.Message("ended release ritual " .. Duel.ReleaseRitualMaterial(Group.FromCards(material_a, material_b)))
      Debug.Message("ended negate " .. Duel.NegateSummon(summoned))
      Debug.Message("ended operated special " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-special-summons.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "ended step false",
      "ended complete 0",
      "ended fusion 0",
      "ended release ritual 0",
      "ended negate 0",
      "ended operated special 0",
    ]);
    expect(session.state.status).toBe("ended");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "900")).toMatchObject({ location: "extraDeck" });
  });
});
