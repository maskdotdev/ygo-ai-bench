import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua ritual position helpers", () => {
  it("honors Ritual procedure summon position masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ritual Position Material", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "500", name: "Ritual Position Watcher", kind: "monster", typeFlags: 0x1, level: 1 },
      { code: "700", name: "Ritual Position Spell", kind: "spell" },
      { code: "940", name: "Ritual Position Monster", kind: "monster", typeFlags: 0x81, level: 4 },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["700", "940", "100", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const ritual = session.state.cards.find((card) => card.code === "940");
    const material = session.state.cards.find((card) => card.code === "100");
    const watcher = session.state.cards.find((card) => card.code === "500");
    expect(ritual).toBeDefined();
    expect(material).toBeDefined();
    expect(watcher).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return ritual:IsFacedown() end)
      e:SetOperation(function(e,tp) Debug.Message("facedown ritual trigger resolved") end)
      watcher:RegisterEffect(e)
      local op = Ritual.Operation({
        handler = spell,
        lvtype = RITPROC_EQUAL,
        filter = aux.FilterBoolFunction(Card.IsCode, 940),
        lv = 4,
        sumpos = POS_FACEDOWN_DEFENSE
      })
      op(Effect.CreateEffect(spell), 0, nil, 0, 0, nil, 0, 0)
      Debug.Message("ritual position complete")
      `,
      "ritual-position-mask.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("ritual position complete");
    expect(host.messages).toContain("confirmed 1: 940");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceDownDefense",
      faceUp: false,
      summonType: "ritual",
      summonMaterialUids: [material!.uid],
    });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "confirmed", eventPlayer: 1, eventUids: [ritual!.uid] });
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ sourceUid: watcher!.uid, eventName: "specialSummoned", eventCardUid: ritual!.uid })]);
  });

  it("honors Ritual procedure specific material filters", () => {
    const cards: DuelCardData[] = [
      { code: "710", name: "Ritual Specific Filter Spell", kind: "spell" },
      { code: "101", name: "Ritual Specific Hand Decoy", kind: "monster", typeFlags: 0x1, level: 8 },
      { code: "102", name: "Ritual Specific Deck Material", kind: "monster", typeFlags: 0x1, level: 8 },
      { code: "941", name: "Ritual Specific Monster", kind: "monster", typeFlags: 0x81, level: 8 },
    ];
    const session = createDuel({ seed: 941, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["710", "941", "101", "102"] }, 1: { main: [] } });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === "710");
    const ritual = session.state.cards.find((card) => card.code === "941");
    const handDecoy = session.state.cards.find((card) => card.code === "101");
    const deckMaterial = session.state.cards.find((card) => card.code === "102");
    expect(spell).toBeDefined();
    expect(ritual).toBeDefined();
    expect(handDecoy).toBeDefined();
    expect(deckMaterial).toBeDefined();
    moveDuelCard(session.state, spell!.uid, "hand", 0);
    moveDuelCard(session.state, ritual!.uid, "hand", 0);
    moveDuelCard(session.state, handDecoy!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 710), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local op = Ritual.Operation({
        handler = spell,
        lvtype = RITPROC_EQUAL,
        filter = aux.FilterBoolFunction(Card.IsCode, 941),
        lv = 8,
        extrafil = function(e,tp)
          return Duel.GetMatchingGroup(function(c) return c:IsMonster() end, tp, LOCATION_DECK, 0, nil)
        end,
        specificmatfilter = function(c,rc,mg,tp)
          return c:IsLocation(LOCATION_DECK)
        end
      })
      op(Effect.CreateEffect(spell), 0, nil, 0, 0, nil, 0, 0)
      Debug.Message("ritual specific filter complete")
      `,
      "ritual-specific-material-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("ritual specific filter complete");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "ritual",
      summonMaterialUids: [deckMaterial!.uid],
    });
    expect(session.state.cards.find((card) => card.uid === deckMaterial!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === handDecoy!.uid)).toMatchObject({ location: "hand" });
  });
});
