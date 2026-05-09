import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

function placeOpponentMonster(session: ReturnType<typeof createDuel>, code: string): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", 1);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

describe("Lua operation immunity sequence changes", () => {
  it("blocks sequence swaps and moves involving immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "194", name: "Sequence Source", kind: "monster" },
      { code: "195", name: "Ignore Sequence Source", kind: "monster" },
      { code: "294", name: "Immune Swap Target", kind: "monster" },
      { code: "295", name: "Immune Move Target", kind: "monster" },
      { code: "394", name: "Open Swap A", kind: "monster" },
      { code: "395", name: "Open Swap B", kind: "monster" },
      { code: "396", name: "Open Move Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 223, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["194", "195"] },
      1: { main: ["294", "295", "394", "395", "396"] },
    });
    startDuel(session);
    for (const code of ["294", "295", "394", "395", "396"]) placeOpponentMonster(session, code);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function opponent_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function register_immune(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c194={}
      function c194.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("swap protected " .. Duel.SwapSequence(opponent_card(294), opponent_card(394)))
          Debug.Message("move protected " .. Duel.MoveSequence(opponent_card(295), 0))
          Debug.Message("blocked sequences " .. opponent_card(294):GetSequence() .. "/" .. opponent_card(295):GetSequence())
          Debug.Message("swap open " .. Duel.SwapSequence(opponent_card(394), opponent_card(395)))
          Debug.Message("move open " .. Duel.MoveSequence(opponent_card(396), 0))
        end)
        c:RegisterEffect(e)
      end
      c195={}
      function c195.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore swap protected " .. Duel.SwapSequence(opponent_card(294), opponent_card(394)))
          Debug.Message("ignore move protected " .. Duel.MoveSequence(opponent_card(295), 0))
        end)
        c:RegisterEffect(e)
      end
      c294={initial_effect=register_immune}
      c295={initial_effect=register_immune}
      `,
      "operation-immunity-sequence.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "194");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "195");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["swap protected 0", "move protected 0", "blocked sequences 0/1", "swap open 1", "move open 1"]));
    expect(session.state.cards.find((card) => card.code === "396")).toMatchObject({ sequence: 0 });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["ignore swap protected 1", "ignore move protected 1"]));
    expect(session.state.cards.find((card) => card.code === "295")).toMatchObject({ sequence: 0 });
  });
});
