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

describe("Lua operation immunity deck order movement", () => {
  it("blocks effect deck-top and deck-bottom movement of immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "190", name: "Deck Order Source", kind: "monster" },
      { code: "191", name: "Ignore Deck Order Source", kind: "monster" },
      { code: "290", name: "Immune Top Target", kind: "monster" },
      { code: "291", name: "Immune Bottom Target", kind: "monster" },
      { code: "390", name: "Open Top Target", kind: "monster" },
      { code: "391", name: "Open Bottom Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 221, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["190", "191"] },
      1: { main: ["290", "291", "390", "391"] },
    });
    startDuel(session);
    for (const code of ["290", "291", "390", "391"]) placeOpponentMonster(session, code);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function opponent_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil)
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
      c190={}
      function c190.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("top protected " .. Duel.MoveToDeckTop(opponent_card(290), 1, REASON_EFFECT))
          Debug.Message("bottom protected " .. Duel.MoveToDeckBottom(opponent_card(291), 1, REASON_EFFECT))
          Debug.Message("top open " .. Duel.MoveToDeckTop(opponent_card(390), 1, REASON_EFFECT))
          Debug.Message("bottom open " .. Duel.MoveToDeckBottom(opponent_card(391), 1, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      c191={}
      function c191.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore top protected " .. Duel.MoveToDeckTop(opponent_card(290), 1, REASON_EFFECT))
          Debug.Message("ignore bottom protected " .. Duel.MoveToDeckBottom(opponent_card(291), 1, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      c290={initial_effect=register_immune}
      c291={initial_effect=register_immune}
      `,
      "operation-immunity-deck-order.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "190");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "191");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["top protected 0", "bottom protected 0", "top open 1", "bottom open 1"]));
    expect(session.state.cards.find((card) => card.code === "290")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "291")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "390")).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.code === "391")).toMatchObject({ location: "deck" });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["ignore top protected 1", "ignore bottom protected 1"]));
    expect(session.state.cards.find((card) => card.code === "290")).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.code === "291")).toMatchObject({ location: "deck" });
  });
});
