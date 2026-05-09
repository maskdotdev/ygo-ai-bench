import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua replacement pending move context", () => {
  it("exposes pending destination and reason to single-card send replacement targets", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Reason Send Replacement", kind: "monster" },
      { code: "101", name: "Effect Reason Send Replacement", kind: "monster" },
      { code: "300", name: "Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 286, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const costReasonThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const effectReasonThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "101");
    const replacementCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(costReasonThreat).toBeTruthy();
    expect(effectReasonThreat).toBeTruthy();
    expect(replacementCost).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local function install(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_SEND_REPLACE)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          local c=e:GetHandler()
          if chk==0 then
            Debug.Message("pending send check " .. c:GetCode() .. "/" .. c:GetDestination() .. "/" .. tostring(c:IsReason(REASON_EFFECT)))
            return c:GetDestination()==LOCATION_GRAVE and c:IsReason(REASON_EFFECT)
          end
          Debug.Message("pending send accepted " .. c:GetCode())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local cost=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode,300), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          Debug.Message("pending send op " .. cost:GetFirst():GetCode())
          Duel.SendtoGrave(cost, REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      c100={}
      function c100.initial_effect(c)
        install(c)
      end
      c101={}
      function c101.initial_effect(c)
        install(c)
      end
      `,
      "send-replacement-pending-context.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    host.messages.splice(0, host.messages.length);

    const costReasonRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("pending cost send result " .. Duel.SendtoGrave(c, REASON_COST))
      `,
      "send-replacement-cost-reason.lua",
    );
    expect(costReasonRun.ok, costReasonRun.error).toBe(true);
    expect(host.messages).toContain("pending send check 100/16/false");
    expect(host.messages).not.toContain("pending send accepted 100");
    expect(host.messages).not.toContain("pending send op 300");
    expect(host.messages).toContain("pending cost send result 1");
    expect(session.state.cards.find((card) => card.uid === costReasonThreat!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === replacementCost!.uid)).toMatchObject({ location: "hand" });

    const effectReasonRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,101), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("pending effect send result " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "send-replacement-effect-reason.lua",
    );
    expect(effectReasonRun.ok, effectReasonRun.error).toBe(true);
    expect(host.messages).toContain("pending send check 101/16/true");
    expect(host.messages).toContain("pending send accepted 101");
    expect(host.messages).toContain("pending send op 300");
    expect(host.messages).toContain("pending effect send result 0");
    expect(session.state.cards.find((card) => card.uid === effectReasonThreat!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === replacementCost!.uid)).toMatchObject({ location: "graveyard" });
  });
});
