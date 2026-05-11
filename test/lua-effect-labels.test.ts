import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua effect labels", () => {
  it("returns every SetLabel value from GetLabel", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Multi Label Source", kind: "monster" }];
    const session = createDuel({ seed: 401, startingHandSize: 0, drawPerTurn: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    source!.location = "hand";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          e:SetLabel(2,4)
          local a,b=e:GetLabel()
          Debug.Message("labels " .. a .. "/" .. b)
        end)
        c:RegisterEffect(e)
      end
      `,
      "multi-label.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("labels 2/4");
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
