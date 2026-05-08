import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua Spell/Trap activation lifecycle", () => {
  it("sends activated normal Spells to the GY after resolution", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Normal Spell", kind: "spell", typeFlags: 0x2 }];
    const session = createDuel({ seed: 293, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_ACTIVATE)
        e:SetCode(EVENT_FREE_CHAIN)
        e:SetOperation(function(e,tp)
          Debug.Message("normal spell resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "normal-spell-activation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const spell = session.state.cards.find((card) => card.code === "100");
    expect(spell).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toContain("normal spell resolved");
    expect(session.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "graveyard" });
  });
});
