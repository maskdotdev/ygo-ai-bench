import { describe, expect, it } from "vitest";
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
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceDownDefense",
      faceUp: false,
      summonType: "ritual",
      summonMaterialUids: [material!.uid],
    });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ sourceUid: watcher!.uid, eventName: "specialSummoned", eventCardUid: ritual!.uid })]);
  });
});
