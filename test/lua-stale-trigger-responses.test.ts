import { describe, expect, it } from "vitest";
import { applyResponse, getLegalActions as getDuelLegalActions } from "#duel/core.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua stale trigger responses", () => {
  it("rejects stale Lua trigger activations after the trigger is consumed", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 105,
      startingHandSize: 2,
      cards: [
        { code: "18100", name: "Lua Stale Trigger Summon", kind: "monster" },
        { code: "18200", name: "Lua Stale Activate Trigger", kind: "monster" },
        { code: "18300", name: "Lua Stale Trigger Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["18100", "18200"] },
        1: { main: ["18300", "18300"] },
      },
      expectedEffects: 1,
      scriptName: "lua-stale-trigger-activation.lua",
      script: `
      c18200={}
      function c18200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale activate trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "18100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeDefined();

    expect(applyResponse(session, staleTrigger!).ok).toBe(true);
    const replay = applyResponse(session, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(host.messages).toEqual(["lua stale activate trigger resolved"]);
  });

  it("rejects stale Lua trigger declines after the trigger is consumed", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 106,
      startingHandSize: 2,
      cards: [
        { code: "19100", name: "Lua Stale Decline Summon", kind: "monster" },
        { code: "19200", name: "Lua Stale Decline Trigger", kind: "monster" },
        { code: "19300", name: "Lua Stale Decline Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["19100", "19200"] },
        1: { main: ["19300", "19300"] },
      },
      expectedEffects: 1,
      scriptName: "lua-stale-trigger-decline.lua",
      script: `
      c19200={}
      function c19200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale decline trigger should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "19100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeDefined();

    expect(applyResponse(session, staleDecline!).ok).toBe(true);
    const replay = applyResponse(session, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(host.messages).toEqual([]);
  });
});
