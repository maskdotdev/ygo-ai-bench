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
    const chained = applyResponse(session, quick!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(0);

    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(session, pass!);

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
    expect(opened.state.waitingFor).toBe(0);
    expect(opened.state.pendingTriggers.map((trigger) => opened.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([opened.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const secondTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === opened.state.pendingTriggers[0]?.effectId);
    expect(secondTrigger).toBeDefined();
    expect(applyResponse(session, secondTrigger!).ok).toBe(true);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.pendingTriggers).toHaveLength(0);
    expect(host.messages).toEqual(["lua second held trigger resolved", "lua first held trigger resolved"]);
  });

  it("keeps later optional Lua trigger bucket activations behind the open chain window", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 93,
      startingHandSize: 3,
      cards: [
        { code: "13100", name: "Lua Optional Window Summon", kind: "monster" },
        { code: "13200", name: "Lua First Optional Window", kind: "monster" },
        { code: "13300", name: "Lua Second Optional Window", kind: "monster" },
        { code: "13400", name: "Lua Optional Window Quick", kind: "monster" },
        { code: "13500", name: "Lua Optional Window Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["13100", "13200", "13300"] },
        1: { main: ["13400", "13500", "13500"] },
      },
      expectedEffects: 3,
      scriptName: "lua-optional-trigger-chain-window.lua",
      script: `
      c13200={}
      function c13200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua first optional window resolved")
        end)
        c:RegisterEffect(e)
      end
      c13300={}
      function c13300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua second optional window resolved")
        end)
        c:RegisterEffect(e)
      end
      c13400={}
      function c13400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua optional window quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "13100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13200", "13300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      session.state.pendingTriggers[0]?.effectId,
      session.state.pendingTriggers[1]?.effectId,
    ]);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstActivation).toBeDefined();
    const opened = applyResponse(session, firstActivation!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(opened.state.pendingTriggers.map((trigger) => opened.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([opened.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    const staleActivation = applyResponse(session, firstActivation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13300"]);

    const secondActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === opened.state.pendingTriggers[0]?.effectId);
    expect(secondActivation).toBeDefined();
    expect(applyResponse(session, secondActivation!).ok).toBe(true);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.pendingTriggers).toHaveLength(0);
    expect(host.messages).toEqual(["lua second optional window resolved", "lua first optional window resolved"]);
  });

  it("declines optional Lua trigger buckets without exposing later player buckets early", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 94,
      startingHandSize: 3,
      cards: [
        { code: "14100", name: "Lua Decline Window Summon", kind: "monster" },
        { code: "14200", name: "Lua First Decline Window", kind: "monster" },
        { code: "14300", name: "Lua Second Decline Window", kind: "monster" },
        { code: "14400", name: "Lua Opponent Decline Window", kind: "monster" },
        { code: "14500", name: "Lua Decline Window Quick", kind: "monster" },
        { code: "14600", name: "Lua Decline Window Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["14100", "14200", "14300"] },
        1: { main: ["14400", "14500", "14600"] },
      },
      expectedEffects: 4,
      scriptName: "lua-optional-trigger-decline-window.lua",
      script: `
      c14200={}
      function c14200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua first decline window resolved")
        end)
        c:RegisterEffect(e)
      end
      c14300={}
      function c14300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua second decline window resolved")
        end)
        c:RegisterEffect(e)
      end
      c14400={}
      function c14400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua opponent decline window resolved")
        end)
        c:RegisterEffect(e)
      end
      c14500={}
      function c14500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua decline quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "14100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14200", "14300", "14400"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      session.state.pendingTriggers[0]?.effectId,
      session.state.pendingTriggers[1]?.effectId,
    ]);

    const firstDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstDecline).toBeDefined();
    const afterFirstDecline = applyResponse(session, firstDecline!);

    expect(afterFirstDecline.ok).toBe(true);
    expect(afterFirstDecline.state.pendingTriggers.map((trigger) => afterFirstDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14300", "14400"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterFirstDecline.state.pendingTriggers[0]?.effectId]);

    const secondDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === afterFirstDecline.state.pendingTriggers[0]?.effectId);
    expect(secondDecline).toBeDefined();
    const afterSecondDecline = applyResponse(session, secondDecline!);

    expect(afterSecondDecline.ok).toBe(true);
    expect(afterSecondDecline.state.pendingTriggers.map((trigger) => afterSecondDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14400"]);
    expect(afterSecondDecline.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterSecondDecline.state.pendingTriggers[0]?.effectId]);
    expect(host.messages).toEqual([]);
  });
});
