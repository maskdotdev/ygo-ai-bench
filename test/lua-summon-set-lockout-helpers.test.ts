import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon and set lockout helpers", () => {
  it("applies cannot-summon effects to Lua summon predicates without blocking sets", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Cannot Summon Target", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 213, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "cannot-summon-target",
      sourceUid: target!.uid,
      controller: 0,
      event: "continuous",
      code: 20,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player can summon locked " .. tostring(Duel.IsPlayerCanSummon(0, c)))
      Debug.Message("card summonable locked " .. tostring(c:IsSummonable()))
      Debug.Message("card summon or set locked " .. tostring(c:CanSummonOrSet()))
      Debug.Message("player can mset unlocked " .. tostring(Duel.IsPlayerCanMSet(0, c)))
      `,
      "cannot-summon-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "player can summon locked false",
      "card summonable locked false",
      "card summon or set locked true",
      "player can mset unlocked true",
    ]);
  });

  it("applies cannot-monster-set effects to Lua set predicates without blocking summons", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Cannot Set Target", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 214, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "cannot-mset-target",
      sourceUid: target!.uid,
      controller: 0,
      event: "continuous",
      code: 23,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player can mset locked " .. tostring(Duel.IsPlayerCanMSet(0, c)))
      Debug.Message("card msetable locked " .. tostring(c:IsMSetable()))
      Debug.Message("card summon or set locked " .. tostring(c:CanSummonOrSet()))
      Debug.Message("player can summon unlocked " .. tostring(Duel.IsPlayerCanSummon(0, c)))
      `,
      "cannot-mset-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "player can mset locked false",
      "card msetable locked false",
      "card summon or set locked true",
      "player can summon unlocked true",
    ]);
  });

  it("applies cannot-spell-trap-set effects to Lua predicates and SSet", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Cannot SSet Target", kind: "spell" }];
    const session = createDuel({ seed: 215, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "cannot-sset-target",
      sourceUid: target!.uid,
      controller: 0,
      event: "continuous",
      code: 24,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("player can sset locked " .. tostring(Duel.CanPlayerSetSpellTrap(0, c:GetFirst())))
      Debug.Message("sset locked " .. Duel.SSet(0, c))
      Debug.Message("sset operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "cannot-sset-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["player can sset locked false", "sset locked 0", "sset operated 0"]);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "hand" });
  });
});
