import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua special summon count helpers", () => {
  it("checks monster-zone capacity for multi-special-summon count predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Filler A", kind: "monster" },
      { code: "200", name: "Filler B", kind: "monster" },
      { code: "300", name: "Filler C", kind: "monster" },
      { code: "400", name: "Filler D", kind: "monster" },
      { code: "500", name: "Filler E", kind: "monster" },
      { code: "600", name: "Pending Summon", kind: "monster" },
    ];
    const session = createDuel({ seed: 190, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["100", "200", "300", "400"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeDefined();
      const moved = moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("count one open " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 1)))
      Debug.Message("count two fullish " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 2)))
      local last = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(last, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK, true)
      Debug.Message("count one full " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 1)))
      `,
      "special-summon-count-zones.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("count one open true");
    expect(host.messages).toContain("count two fullish false");
    expect(host.messages).toContain("count one full false");
  });
});
