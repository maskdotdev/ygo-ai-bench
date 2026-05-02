import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua activation lockout helpers", () => {
  it("suppresses Lua effect activation actions for cards affected by cannot-activate effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Cannot Activate Source", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 217, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("locked activation resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CANNOT_ACTIVATE)
        e2:SetRange(LOCATION_HAND)
        c:RegisterEffect(e2)
      end
      `,
      "cannot-activate.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toHaveLength(2);
    expect(session.state.effects.map((effect) => effect.event)).toEqual(["ignition", "continuous"]);

    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    const lockedAction = { type: "activateEffect" as const, player: 0 as const, uid: source!.uid, effectId: session.state.effects[0]!.id, label: "Locked activation" };

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === source!.uid)).toBe(false);
    expect(applyResponse(session, lockedAction).ok).toBe(false);
    expect(host.messages).toEqual([]);
  });
});
