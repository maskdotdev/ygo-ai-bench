import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel destruction", () => {
  it("prevents effect destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "effect-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 41,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);

    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");
    expect(queryPublicState(session).log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("consumes counted indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "counted-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 47,
      value: 1,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("graveyard");
  });

  it("queues Lua destroy triggers before destroyed triggers", () => {
    const session = createDuel({ seed: 2, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const target = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeTruthy();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_DESTROY)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("lua destroy resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-destroy-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    destroyDuelCard(session.state, target!.uid, 0);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["destroying"]);
    expect(session.state.eventHistory.map((event) => event.eventName)).toContain("destroying");
    expect(session.state.eventHistory.map((event) => event.eventName)).toContain("destroyed");
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua destroy resolved 100");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
