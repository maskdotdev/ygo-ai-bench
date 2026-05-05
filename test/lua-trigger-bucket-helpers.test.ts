import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua trigger bucket helpers", () => {
  it("orders Lua cross-player trigger buckets", () => {
    const cards: DuelCardData[] = [
      { code: "8100", name: "Lua Bucket Summon", kind: "monster" },
      { code: "8200", name: "Lua Turn Optional", kind: "monster" },
      { code: "8300", name: "Lua Turn Mandatory", kind: "monster" },
      { code: "8400", name: "Lua Opponent Mandatory", kind: "monster" },
      { code: "8500", name: "Lua Opponent Optional", kind: "monster" },
      { code: "8600", name: "Lua Bucket Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 88, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["8100", "8200", "8300"] },
      1: { main: ["8400", "8500", "8600"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c8500={}
      function c8500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("opponent optional bucket")
        end)
        c:RegisterEffect(e)
      end
      c8200={}
      function c8200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("turn optional bucket")
        end)
        c:RegisterEffect(e)
      end
      c8400={}
      function c8400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_F)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("opponent mandatory bucket")
        end)
        c:RegisterEffect(e)
      end
      c8300={}
      function c8300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_F)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("turn mandatory bucket")
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-cross-player-trigger-buckets.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "8100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);

    expect(summoned.ok).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => summoned.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["8300", "8400", "8200", "8500"]);
    expect(summoned.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).filter((action) => (action.type === "activateTrigger" || action.type === "declineTrigger") && action.effectId === summoned.state.pendingTriggers[0]?.effectId).map((action) => action.type)).toEqual(["activateTrigger"]);

    const turnMandatory = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === summoned.state.pendingTriggers[0]?.effectId);
    expect(turnMandatory).toBeDefined();
    const afterTurnMandatory = applyResponse(session, turnMandatory!);
    expect(afterTurnMandatory.ok).toBe(true);
    expect(afterTurnMandatory.state.pendingTriggers.map((trigger) => afterTurnMandatory.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["8400", "8200", "8500"]);
    expect(afterTurnMandatory.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 1).map((action) => action.type)).toEqual(["activateTrigger"]);

    const opponentMandatory = getDuelLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.effectId === afterTurnMandatory.state.pendingTriggers[0]?.effectId);
    expect(opponentMandatory).toBeDefined();
    const afterOpponentMandatory = applyResponse(session, opponentMandatory!);
    expect(afterOpponentMandatory.ok).toBe(true);
    expect(afterOpponentMandatory.state.pendingTriggers.map((trigger) => afterOpponentMandatory.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["8200", "8500"]);
    expect(afterOpponentMandatory.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 0).filter((action) => (action.type === "activateTrigger" || action.type === "declineTrigger") && action.effectId === afterOpponentMandatory.state.pendingTriggers[0]?.effectId).map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);

    const turnOptionalDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === afterOpponentMandatory.state.pendingTriggers[0]?.effectId);
    expect(turnOptionalDecline).toBeDefined();
    const afterTurnOptional = applyResponse(session, turnOptionalDecline!);
    expect(afterTurnOptional.ok).toBe(true);
    expect(afterTurnOptional.state.pendingTriggers.map((trigger) => afterTurnOptional.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["8500"]);
    expect(afterTurnOptional.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 1).filter((action) => (action.type === "activateTrigger" || action.type === "declineTrigger") && action.effectId === afterTurnOptional.state.pendingTriggers[0]?.effectId).map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);
  });

  it("declines Lua optional trigger buckets without exposing later buckets early", () => {
    const cards: DuelCardData[] = [
      { code: "9100", name: "Lua Optional Bucket Summon", kind: "monster" },
      { code: "9200", name: "Lua First Turn Optional", kind: "monster" },
      { code: "9300", name: "Lua Second Turn Optional", kind: "monster" },
      { code: "9400", name: "Lua Opponent Optional", kind: "monster" },
      { code: "9500", name: "Lua Optional Bucket Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 89, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["9100", "9200", "9300"] },
      1: { main: ["9400", "9500", "9500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c9400={}
      function c9400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("opponent optional bucket")
        end)
        c:RegisterEffect(e)
      end
      c9200={}
      function c9200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("first turn optional bucket")
        end)
        c:RegisterEffect(e)
      end
      c9300={}
      function c9300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("second turn optional bucket")
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-optional-trigger-bucket-declines.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "9100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);

    expect(summoned.ok).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => summoned.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["9200", "9300", "9400"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([summoned.state.pendingTriggers[0]?.effectId, summoned.state.pendingTriggers[1]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const firstDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === summoned.state.pendingTriggers[0]?.effectId);
    expect(firstDecline).toBeDefined();
    const afterFirstDecline = applyResponse(session, firstDecline!);
    expect(afterFirstDecline.ok).toBe(true);
    expect(afterFirstDecline.state.pendingTriggers.map((trigger) => afterFirstDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["9300", "9400"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterFirstDecline.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const secondDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === afterFirstDecline.state.pendingTriggers[0]?.effectId);
    expect(secondDecline).toBeDefined();
    const afterSecondDecline = applyResponse(session, secondDecline!);
    expect(afterSecondDecline.ok).toBe(true);
    expect(afterSecondDecline.state.pendingTriggers.map((trigger) => afterSecondDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["9400"]);
    expect(afterSecondDecline.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterSecondDecline.state.pendingTriggers[0]?.effectId]);
  });

  it("activates Lua optional trigger buckets without exposing later buckets early", () => {
    const cards: DuelCardData[] = [
      { code: "10100", name: "Lua Optional Activation Summon", kind: "monster" },
      { code: "10200", name: "Lua First Turn Optional Activation", kind: "monster" },
      { code: "10300", name: "Lua Second Turn Optional Activation", kind: "monster" },
      { code: "10400", name: "Lua Opponent Optional Activation", kind: "monster" },
      { code: "10500", name: "Lua Optional Activation Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 90, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["10100", "10200", "10300"] },
      1: { main: ["10400", "10500", "10500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c10400={}
      function c10400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("opponent optional activation")
        end)
        c:RegisterEffect(e)
      end
      c10200={}
      function c10200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("first turn optional activation")
        end)
        c:RegisterEffect(e)
      end
      c10300={}
      function c10300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("second turn optional activation")
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-optional-trigger-bucket-activations.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "10100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);

    expect(summoned.ok).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => summoned.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["10200", "10300", "10400"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([summoned.state.pendingTriggers[0]?.effectId, summoned.state.pendingTriggers[1]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === summoned.state.pendingTriggers[0]?.effectId);
    expect(firstActivation).toBeDefined();
    const afterFirstActivation = applyResponse(session, firstActivation!);
    expect(afterFirstActivation.ok).toBe(true);
    expect(afterFirstActivation.state.pendingTriggers.map((trigger) => afterFirstActivation.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["10300", "10400"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([afterFirstActivation.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const secondActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === afterFirstActivation.state.pendingTriggers[0]?.effectId);
    expect(secondActivation).toBeDefined();
    const afterSecondActivation = applyResponse(session, secondActivation!);
    expect(afterSecondActivation.ok).toBe(true);
    expect(afterSecondActivation.state.pendingTriggers.map((trigger) => afterSecondActivation.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["10400"]);
    expect(afterSecondActivation.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([afterSecondActivation.state.pendingTriggers[0]?.effectId]);
  });
});
