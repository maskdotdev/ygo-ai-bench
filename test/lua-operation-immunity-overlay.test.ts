import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, PlayerId } from "#duel/types.js";

function placeMonster(session: ReturnType<typeof createDuel>, code: string, controller: PlayerId): void {
  const card = session.state.cards.find((candidate) => candidate.controller === controller && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", controller);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

describe("Lua operation immunity overlay", () => {
  it("blocks overlay attachment of immune cards unless the active effect ignores immunity", () => {
    const cards: DuelCardData[] = [
      { code: "180", name: "Overlay Source", kind: "monster" },
      { code: "181", name: "Ignore Overlay Source", kind: "monster" },
      { code: "980", name: "Overlay Holder", kind: "monster" },
      { code: "280", name: "Immune Overlay Material", kind: "monster" },
      { code: "380", name: "Open Overlay Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 220, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["180", "181", "980"] },
      1: { main: ["280", "380"] },
    });
    startDuel(session);
    placeMonster(session, "980", 0);
    placeMonster(session, "280", 1);
    placeMonster(session, "380", 1);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function holder()
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 980), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function opponent_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil)
      end
      c180={}
      function c180.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local xyz=holder()
          Duel.Overlay(xyz, opponent_card(280))
          Debug.Message("overlay protected count " .. xyz:GetOverlayCount())
          Duel.Overlay(xyz, opponent_card(380))
          Debug.Message("overlay open count " .. xyz:GetOverlayCount())
        end)
        c:RegisterEffect(e)
      end
      c181={}
      function c181.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local xyz=holder()
          Duel.Overlay(xyz, opponent_card(280))
          Debug.Message("ignore overlay protected count " .. xyz:GetOverlayCount())
        end)
        c:RegisterEffect(e)
      end
      c280={}
      function c280.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-immunity-overlay.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "180");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "181");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    const holderCard = session.state.cards.find((card) => card.code === "980");
    expect(host.messages).toEqual(expect.arrayContaining(["overlay protected count 0", "overlay open count 1"]));
    expect(holderCard?.overlayUids).toEqual([session.state.cards.find((card) => card.code === "380")!.uid]);
    expect(session.state.cards.find((card) => card.code === "280")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "380")).toMatchObject({ location: "overlay" });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toContain("ignore overlay protected count 2");
    const updatedHolderCard = session.state.cards.find((card) => card.uid === holderCard!.uid);
    expect(updatedHolderCard?.overlayUids).toEqual(expect.arrayContaining([session.state.cards.find((card) => card.code === "280")!.uid]));
    expect(session.state.cards.find((card) => card.code === "280")).toMatchObject({ location: "overlay" });
  });
});
