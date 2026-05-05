import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua ended effect helpers", () => {
  it("keeps effect registration helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Effect Source", kind: "monster" },
      { code: "200", name: "Ended Effect Receiver", kind: "monster" },
    ];
    const session = createDuel({ seed: 227, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local receiver = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local before = Effect.CreateEffect(source)
      before:SetType(EFFECT_TYPE_SINGLE)
      before:SetCode(EFFECT_CANNOT_ATTACK)
      source:RegisterEffect(before)
      Duel.Win(0, WIN_REASON_EXODIA)
      local card_effect = Effect.CreateEffect(source)
      card_effect:SetType(EFFECT_TYPE_SINGLE)
      card_effect:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      source:RegisterEffect(card_effect)
      local global = Effect.GlobalEffect()
      global:SetType(EFFECT_TYPE_FIELD)
      global:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      Debug.Message("ended duel register " .. tostring(Duel.RegisterEffect(global, 0)))
      Debug.Message("ended majestic " .. Duel.MajesticCopy(receiver, source))
      Debug.Message("ended activate " .. tostring(Duel.Activate(before)))
      `,
      "ended-effect-registration.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["ended duel register false", "ended majestic 0", "ended activate false"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ sourceUid: session.state.cards.find((card) => card.code === "100")?.uid, code: 85 });
  });
});
