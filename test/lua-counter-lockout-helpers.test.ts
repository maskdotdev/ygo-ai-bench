import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua counter lockout helpers", () => {
  it("prevents Lua counter placement on affected cards", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Counter Locked", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 219, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_PLACE_COUNTER)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "counter-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const checked = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("can add locked " .. tostring(c:IsCanAddCounter(99,1)))
      Debug.Message("duel can add locked " .. tostring(Duel.IsCanAddCounter(0,99,1,c)))
      Debug.Message("add locked " .. tostring(c:AddCounter(99,1)))
      Debug.Message("counter count " .. c:GetCounter(99))
      `,
      "counter-lockout-check.lua",
    );

    expect(checked.ok, checked.error).toBe(true);
    expect(host.messages).toEqual(["can add locked false", "duel can add locked false", "add locked false", "counter count 0"]);
    expect(session.state.pendingTriggers).toHaveLength(0);
  });

  it("applies targeted field counter lockouts only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Counter Lock Source", kind: "monster", level: 4 },
      { code: "200", name: "Counter Locked", kind: "monster", level: 4 },
      { code: "300", name: "Counter Open", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 223, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_PLACE_COUNTER)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-counter-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const checked = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local open=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("targeted counter predicates " .. tostring(locked:IsCanAddCounter(99,1)) .. "/" .. tostring(open:IsCanAddCounter(99,1)))
      Debug.Message("targeted counter add " .. tostring(locked:AddCounter(99,1)) .. "/" .. tostring(open:AddCounter(99,1)))
      Debug.Message("targeted counter counts " .. locked:GetCounter(99) .. "/" .. open:GetCounter(99))
      `,
      "targeted-counter-lockout-check.lua",
    );

    expect(checked.ok, checked.error).toBe(true);
    expect(host.messages).toEqual(["targeted counter predicates false/true", "targeted counter add false/true", "targeted counter counts 0/1"]);
  });
});
