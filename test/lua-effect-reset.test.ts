import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getLegalActions as getDuelLegalActions } from "#duel/core.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua effect reset", () => {
  it("removes Lua RESET_TOGRAVE effects when their source goes to the Graveyard", () => {
    const { session } = setupLuaChainFixture({
      seed: 119,
      startingHandSize: 1,
      cards: [
        { code: "21100", name: "Lua Reset Grave Source", kind: "monster" },
        { code: "21200", name: "Lua Reset Grave Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["21100"] },
        1: { main: ["21200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-to-grave.lua",
      script: `
      c21100={}
      function c21100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_EVENT + RESET_TOGRAVE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset to grave should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "21100");
    expect(source).toBeDefined();

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
  });

  it("removes Lua reset-event effects when their source leaves range", () => {
    const { session } = setupLuaChainFixture({
      seed: 115,
      startingHandSize: 1,
      cards: [
        { code: "20100", name: "Lua Reset Source", kind: "monster" },
        { code: "20200", name: "Lua Reset Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["20100"] },
        1: { main: ["20200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset.lua",
      script: `
      c20100={}
      function c20100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_EVENT + RESETS_STANDARD)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset effect should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "20100");
    expect(source).toBeDefined();
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(true);

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(false);
  });
});
