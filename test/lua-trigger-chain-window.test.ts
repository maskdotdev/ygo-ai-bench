import { describe, expect, it } from "vitest";
import { applyResponse, getLegalActions as getDuelLegalActions } from "#duel/core.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua trigger chain windows", () => {
  it("offers Lua trigger controller quick responses when the opponent cannot chain", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 91,
      startingHandSize: 3,
      cards: [
        { code: "11100", name: "Lua Self Chain Summon", kind: "monster" },
        { code: "11200", name: "Lua Self Chain Trigger", kind: "monster" },
        { code: "11300", name: "Lua Self Chain Quick", kind: "monster" },
        { code: "11400", name: "Lua Self Chain Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["11100", "11200", "11300"] },
        1: { main: ["11400", "11400", "11400"] },
      },
      expectedEffects: 2,
      scriptName: "lua-self-trigger-chain-window.lua",
      script: `
      c11200={}
      function c11200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua self trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      c11300={}
      function c11300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua self quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "11100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const opened = applyResponse(session, trigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).map((action) => action.type)).toEqual(["activateEffect", "passChain"]);

    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(quick).toBeDefined();
    const resolved = applyResponse(session, quick!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(host.messages).toEqual(["lua self quick resolved", "lua self trigger resolved"]);
  });

  it("holds sibling Lua pending triggers behind the open trigger chain window", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 92,
      startingHandSize: 3,
      cards: [
        { code: "12100", name: "Lua Held Trigger Summon", kind: "monster" },
        { code: "12200", name: "Lua First Held Trigger", kind: "monster" },
        { code: "12300", name: "Lua Second Held Trigger", kind: "monster" },
        { code: "12400", name: "Lua Opponent Chain Quick", kind: "monster" },
        { code: "12500", name: "Lua Chain Window Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["12100", "12200", "12300"] },
        1: { main: ["12400", "12500", "12500"] },
      },
      expectedEffects: 3,
      scriptName: "lua-held-trigger-chain-window.lua",
      script: `
      c12200={}
      function c12200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua first held trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      c12300={}
      function c12300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua second held trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      c12400={}
      function c12400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua opponent quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "12100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12200", "12300"]);

    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    const opened = applyResponse(session, firstTrigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.pendingTriggers.map((trigger) => opened.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300"]);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).map((action) => action.type)).toEqual(["activateEffect", "passChain"]);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.pendingTriggers.map((trigger) => resolved.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([resolved.state.pendingTriggers[0]?.effectId]);
    expect(host.messages).toEqual(["lua first held trigger resolved"]);
  });
});
