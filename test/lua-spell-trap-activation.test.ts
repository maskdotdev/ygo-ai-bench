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

  it("sends remain-field Trap activations to the GY when CancelToGrave(false) clears the keep-on-field marker", () => {
    const cards: DuelCardData[] = [{ code: "107", name: "Fizzling Remain Trap", kind: "trap", typeFlags: 0x4 }];
    const session = createDuel({ seed: 297, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["107"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c107={}
      function c107.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_ACTIVATE)
        e:SetCode(EVENT_FREE_CHAIN)
        e:SetCost(aux.RemainFieldCost)
        e:SetOperation(function(e,tp)
          e:GetHandler():CancelToGrave(false)
          Debug.Message("remain trap fizzle")
        end)
        c:RegisterEffect(e)
      end
      `,
      "remain-trap-fizzle.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const trap = session.state.cards.find((card) => card.code === "107");
    expect(trap).toBeDefined();
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === trap!.uid);
    expect(setAction).toBeDefined();
    expect(applyResponse(session, setAction!).ok).toBe(true);
    const activation = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(activation).toBeDefined();
    const result = applyResponse(session, activation!);
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toContain("remain trap fizzle");
    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({ location: "graveyard", cancelToGrave: false });
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

  it("hides hand Spell activations when the Spell & Trap Zone is full", () => {
    const cards: DuelCardData[] = [
      { code: "101", name: "Zone Filler 1", kind: "spell", typeFlags: 0x2 },
      { code: "102", name: "Zone Filler 2", kind: "spell", typeFlags: 0x2 },
      { code: "103", name: "Zone Filler 3", kind: "spell", typeFlags: 0x2 },
      { code: "104", name: "Zone Filler 4", kind: "spell", typeFlags: 0x2 },
      { code: "105", name: "Zone Filler 5", kind: "spell", typeFlags: 0x2 },
      { code: "106", name: "Blocked Normal Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 296, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101", "102", "103", "104", "105", "106"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c106={}
      function c106.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_ACTIVATE)
        e:SetCode(EVENT_FREE_CHAIN)
        e:SetOperation(function(e,tp)
          Debug.Message("blocked normal spell resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "blocked-normal-spell-activation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    for (const code of ["101", "102", "103", "104", "105"]) {
      const filler = session.state.cards.find((card) => card.code === code);
      expect(filler).toBeDefined();
      const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === filler!.uid);
      expect(setAction).toBeDefined();
      expect(applyResponse(session, setAction!).ok).toBe(true);
    }

    const blockedSpell = session.state.cards.find((card) => card.code === "106");
    expect(blockedSpell).toBeDefined();
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "spellTrapZone")).toHaveLength(5);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.uid === blockedSpell!.uid)).toBe(false);
  });
});
