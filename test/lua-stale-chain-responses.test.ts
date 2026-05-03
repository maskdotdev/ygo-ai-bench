import { describe, expect, it } from "vitest";
import { applyResponse, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions } from "#duel/core.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua stale chain responses", () => {
  it("rejects stale Lua pass responses after a chain resolves", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 101,
      startingHandSize: 2,
      cards: [
        { code: "16100", name: "Lua Stale Pass Source", kind: "monster" },
        { code: "16200", name: "Lua Stale Pass Quick", kind: "monster" },
        { code: "16300", name: "Lua Stale Pass Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["16100", "16300"] },
        1: { main: ["16200", "16300"] },
      },
      expectedEffects: 2,
      scriptName: "lua-stale-pass-response.lua",
      script: `
      c16100={}
      function c16100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale pass source resolved")
        end)
        c:RegisterEffect(e)
      end
      c16200={}
      function c16200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale pass quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "16100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeDefined();

    expect(applyResponse(session, stalePass!).ok).toBe(true);
    const replay = applyResponse(session, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expect(host.messages).toEqual(["lua stale pass source resolved"]);
  });

  it("rejects stale Lua quick responses after their chain window closes", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 102,
      startingHandSize: 2,
      cards: [
        { code: "17100", name: "Lua Stale Quick Source", kind: "monster" },
        { code: "17200", name: "Lua Stale Self Quick", kind: "monster" },
        { code: "17300", name: "Lua Stale Quick Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["17100", "17200"] },
        1: { main: ["17300", "17300"] },
      },
      expectedEffects: 2,
      scriptName: "lua-stale-quick-response.lua",
      script: `
      c17100={}
      function c17100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale quick source resolved")
        end)
        c:RegisterEffect(e)
      end
      c17200={}
      function c17200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale self quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "17100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    expect(opened.state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(staleQuick).toBeDefined();
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);

    const replay = applyResponse(session, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expect(host.messages).toEqual(["lua stale quick source resolved"]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(true);
  });
});
