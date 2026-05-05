import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
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

  it("applies targeted field cannot-activate effects only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Activation Lock Source", kind: "monster", level: 4 },
      { code: "200", name: "Activation Locked", kind: "monster", level: 4 },
      { code: "300", name: "Activation Open", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 223, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_ACTIVATE)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("locked resolved") end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("open resolved") end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-cannot-activate.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const locked = session.state.cards.find((card) => card.code === "200");
    const open = session.state.cards.find((card) => card.code === "300");
    expect(locked).toBeDefined();
    expect(open).toBeDefined();
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === locked!.uid)).toBe(false);
    const openAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === open!.uid);
    expect(openAction).toBeDefined();
    applyAndAssert(session, openAction!);
    expect(host.messages).toEqual(["open resolved"]);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
