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

  it("requires default Trap activations to be set before activation", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Normal Trap", kind: "trap", typeFlags: 0x4 }];
    const session = createDuel({ seed: 294, startingHandSize: 1, cardReader: createCardReader(cards) });
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
          Debug.Message("normal trap resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "normal-trap-activation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const trap = session.state.cards.find((card) => card.code === "100");
    expect(trap).toBeDefined();
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid)).toBe(false);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === trap!.uid);
    expect(setAction).toBeDefined();
    const setResult = applyResponse(session, setAction!);
    expect(setResult.ok, setResult.error).toBe(true);

    const activation = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(activation).toBeDefined();
    const result = applyResponse(session, activation!);
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toContain("normal trap resolved");
    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("honors explicit hand range for Trap activations", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Hand Trap Activation", kind: "trap", typeFlags: 0x4 }];
    const session = createDuel({ seed: 295, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("hand trap activation resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "hand-trap-activation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const trap = session.state.cards.find((card) => card.code === "100");
    expect(trap).toBeDefined();
    const activation = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(activation).toBeDefined();
    const result = applyResponse(session, activation!);
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toContain("hand trap activation resolved");
    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({ location: "graveyard" });
  });
});
