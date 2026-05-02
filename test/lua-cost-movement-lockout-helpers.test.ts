import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua cost movement lockout helpers", () => {
  it("applies cannot-to-grave-as-cost effects without blocking effect sends", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Grave Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Cost Send", kind: "monster" },
    ];
    const session = createDuel({ seed: 212, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "cannot-to-grave-as-cost",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 59,
      range: ["hand"],
      targetRange: [1, 0],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can grave effect " .. tostring(Duel.IsPlayerCanSendtoGrave(0, c, REASON_EFFECT)))
      Debug.Message("can grave cost " .. tostring(Duel.IsPlayerCanSendtoGrave(0, c, REASON_COST)))
      Debug.Message("able grave " .. tostring(c:IsAbleToGrave()))
      Debug.Message("able grave cost " .. tostring(c:IsAbleToGraveAsCost()))
      Debug.Message("send grave cost " .. Duel.SendtoGrave(c, REASON_COST))
      Debug.Message("send cost operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "cannot-to-grave-as-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "can grave effect true",
      "can grave cost false",
      "able grave true",
      "able grave cost false",
      "send grave cost 0",
      "send cost operated 0",
    ]);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "hand" });
  });

  it("applies cannot-use-as-cost effects without blocking effect movement", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Use Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Cost Use", kind: "monster" },
    ];
    const session = createDuel({ seed: 222, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "cannot-use-as-cost",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 57,
      range: ["hand"],
      targetRange: [1, 0],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can remove effect " .. tostring(Duel.IsPlayerCanRemove(0, c, REASON_EFFECT)))
      Debug.Message("can remove cost " .. tostring(Duel.IsPlayerCanRemove(0, c, REASON_COST)))
      Debug.Message("able remove " .. tostring(c:IsAbleToRemove()))
      Debug.Message("able remove cost " .. tostring(c:IsAbleToRemoveAsCost()))
      Debug.Message("remove cost " .. Duel.Remove(c, POS_FACEUP, REASON_COST))
      Debug.Message("remove cost operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove effect " .. Duel.Remove(c, POS_FACEUP, REASON_EFFECT))
      `,
      "cannot-use-as-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "can remove effect true",
      "can remove cost false",
      "able remove true",
      "able remove cost false",
      "remove cost 0",
      "remove cost operated 0",
      "remove effect 1",
    ]);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished" });
  });
});
