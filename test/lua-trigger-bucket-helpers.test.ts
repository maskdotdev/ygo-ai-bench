import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    expect(queryPublicState(session).triggerOrderPrompt).toEqual({
      id: `${session.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: [
        summoned.state.pendingTriggers[0]!.id,
        summoned.state.pendingTriggers[1]!.id,
      ],
    });
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([summoned.state.pendingTriggers[0]?.effectId, summoned.state.pendingTriggers[1]?.effectId]);
    expect(getGroupedDuelLegalActions(session, 0).filter((group) => group.label === "Trigger Declines").map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: queryPublicState(session).triggerOrderPrompt!.triggerIds },
    ]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const firstDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === summoned.state.pendingTriggers[0]?.effectId);
    expect(firstDecline).toBeDefined();
    const afterFirstDecline = applyResponse(session, firstDecline!);
    expect(afterFirstDecline.ok).toBe(true);
    expect(afterFirstDecline.state.pendingTriggers.map((trigger) => afterFirstDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["9300", "9400"]);
    expect(queryPublicState(session).triggerOrderPrompt).toBeUndefined();
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
    expect(queryPublicState(session).triggerOrderPrompt).toEqual({
      id: `${session.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: [
        summoned.state.pendingTriggers[0]!.id,
        summoned.state.pendingTriggers[1]!.id,
      ],
    });
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([summoned.state.pendingTriggers[0]?.effectId, summoned.state.pendingTriggers[1]?.effectId]);
    expect(getGroupedDuelLegalActions(session, 0).filter((group) => group.label === "Trigger Activations").map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: queryPublicState(session).triggerOrderPrompt!.triggerIds },
    ]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === summoned.state.pendingTriggers[0]?.effectId);
    expect(firstActivation).toBeDefined();
    const afterFirstActivation = applyResponse(session, firstActivation!);
    expect(afterFirstActivation.ok).toBe(true);
    expect(afterFirstActivation.state.pendingTriggers.map((trigger) => afterFirstActivation.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["10300", "10400"]);
    expect(queryPublicState(session).triggerOrderPrompt).toBeUndefined();
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

  it("restores Lua same-bucket optional trigger prompts before later buckets", () => {
    const cards: DuelCardData[] = [
      { code: "11100", name: "Lua Restore Bucket Summon", kind: "monster" },
      { code: "11200", name: "Lua Restore First Optional", kind: "monster" },
      { code: "11300", name: "Lua Restore Second Optional", kind: "monster" },
      { code: "11400", name: "Lua Restore Opponent Optional", kind: "monster" },
      { code: "11500", name: "Lua Restore Bucket Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c11200.lua") {
          return `
          c11200={}
          function c11200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored first optional bucket")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c11300.lua") {
          return `
          c11300={}
          function c11300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored second optional bucket")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c11400.lua") {
          return `
          c11400={}
          function c11400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored opponent optional bucket")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 91, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["11100", "11200", "11300"] },
      1: { main: ["11400", "11500", "11500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(11200, source).ok).toBe(true);
    expect(host.loadCardScript(11300, source).ok).toBe(true);
    expect(host.loadCardScript(11400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "11100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);
    expect(summoned.ok).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => summoned.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["11200", "11300", "11400"]);
    expect(queryPublicState(session).triggerOrderPrompt?.triggerIds).toEqual([summoned.state.pendingTriggers[0]!.id, summoned.state.pendingTriggers[1]!.id]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => restored.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["11200", "11300", "11400"]);
    expect(queryPublicState(restored.session).triggerOrderPrompt?.triggerIds).toEqual([restored.session.state.pendingTriggers[0]!.id, restored.session.state.pendingTriggers[1]!.id]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const firstActivation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === restored.session.state.pendingTriggers[0]?.effectId);
    expect(firstActivation).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    const firstEffectId = restored.session.state.pendingTriggers[0]?.effectId;
    const afterFirstActivation = applyLuaRestoreAndAssert(restored, firstActivation!);
    expect(afterFirstActivation.state.chain.map((link) => link.effectId)).toEqual([firstEffectId]);
    expect(afterFirstActivation.state.pendingTriggers.map((trigger) => afterFirstActivation.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["11300", "11400"]);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toBeUndefined();
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([afterFirstActivation.state.pendingTriggers[0]?.effectId]);
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(restored.host.messages).toEqual([]);
    const staleFirstActivation = applyLuaRestoreResponse(restored, firstActivation!);
    expect(staleFirstActivation.ok).toBe(false);
    expect(staleFirstActivation.error).toContain("Response is not currently legal");
    expect(staleFirstActivation.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleFirstActivation.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleFirstActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleFirstActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleFirstActivation.legalActions);

    const secondEffectId = restored.session.state.pendingTriggers[0]?.effectId;
    const secondActivation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === secondEffectId);
    expect(secondActivation).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    const afterSecondActivation = applyLuaRestoreAndAssert(restored, secondActivation!);
    expect(afterSecondActivation.state.chain.map((link) => link.effectId)).toEqual([firstEffectId, secondEffectId]);
    expect(afterSecondActivation.state.pendingTriggers.map((trigger) => afterSecondActivation.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["11400"]);
    expect(afterSecondActivation.state.waitingFor).toBe(1);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterSecondActivation.state.pendingTriggers[0]?.effectId, afterSecondActivation.state.pendingTriggers[0]?.effectId]);
    const staleSecondActivation = applyLuaRestoreResponse(restored, secondActivation!);
    expect(staleSecondActivation.ok).toBe(false);
    expect(staleSecondActivation.error).toContain("Response is not currently legal");
    expect(staleSecondActivation.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleSecondActivation.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleSecondActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleSecondActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleSecondActivation.legalActions);

    const opponentDecline = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "declineTrigger");
    expect(opponentDecline).toMatchObject({ player: 1, windowKind: "triggerBucket", triggerBucket: "opponentOptional" });
    const resolved = applyLuaRestoreAndAssert(restored, opponentDecline!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(resolved.state.chain).toEqual([]);
    expect(resolved.state.pendingTriggers).toEqual([]);

    const replay = applyLuaRestoreResponse(restored, opponentDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.host.messages).toEqual(["restored second optional bucket", "restored first optional bucket"]);
  });

  it("restores Lua cross-player trigger bucket priority through chain resolution", () => {
    const cards: DuelCardData[] = [
      { code: "12100", name: "Lua Restore Cross Bucket Summon", kind: "monster" },
      { code: "12200", name: "Lua Restore Turn Optional", kind: "monster" },
      { code: "12300", name: "Lua Restore Turn Mandatory", kind: "monster" },
      { code: "12400", name: "Lua Restore Opponent Mandatory", kind: "monster" },
      { code: "12500", name: "Lua Restore Opponent Optional", kind: "monster" },
      { code: "12600", name: "Lua Restore Cross Bucket Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c12200.lua") return luaSummonTriggerScript(12200, "EFFECT_TYPE_TRIGGER_O", "restored turn optional bucket");
        if (name === "c12300.lua") return luaSummonTriggerScript(12300, "EFFECT_TYPE_TRIGGER_F", "restored turn mandatory bucket");
        if (name === "c12400.lua") return luaSummonTriggerScript(12400, "EFFECT_TYPE_TRIGGER_F", "restored opponent mandatory bucket");
        if (name === "c12500.lua") return luaSummonTriggerScript(12500, "EFFECT_TYPE_TRIGGER_O", "restored opponent optional bucket");
        return undefined;
      },
    };
    const session = createDuel({ seed: 92, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["12100", "12200", "12300"] },
      1: { main: ["12400", "12500", "12600"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(12200, source).ok).toBe(true);
    expect(host.loadCardScript(12300, source).ok).toBe(true);
    expect(host.loadCardScript(12400, source).ok).toBe(true);
    expect(host.loadCardScript(12500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "12100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);
    expect(summoned.ok).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => summoned.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300", "12400", "12200", "12500"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => restored.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300", "12400", "12200", "12500"]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger"]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const turnMandatory = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(turnMandatory).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnMandatory" });
    const afterTurnMandatory = applyLuaRestoreAndAssert(restored, turnMandatory!);
    expect(afterTurnMandatory.state.chain).toHaveLength(1);
    expect(afterTurnMandatory.state.pendingTriggers.map((trigger) => afterTurnMandatory.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12400", "12200", "12500"]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger"]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const staleTurnMandatory = applyLuaRestoreResponse(restored, turnMandatory!);
    expect(staleTurnMandatory.ok).toBe(false);
    expect(staleTurnMandatory.error).toContain("Response is not currently legal");
    expect(staleTurnMandatory.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTurnMandatory.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleTurnMandatory.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleTurnMandatory.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTurnMandatory.legalActions);

    const restoredAfterTurnMandatory = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredAfterTurnMandatory.restoreComplete, restoredAfterTurnMandatory.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterTurnMandatory.session.state.chain).toHaveLength(1);
    expect(restoredAfterTurnMandatory.session.state.pendingTriggers.map((trigger) => restoredAfterTurnMandatory.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12400", "12200", "12500"]);
    expect(getLuaRestoreLegalActions(restoredAfterTurnMandatory, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredAfterTurnMandatory, 1)).toEqual(getDuelLegalActions(restoredAfterTurnMandatory.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredAfterTurnMandatory, 1)).toEqual(getGroupedDuelLegalActions(restoredAfterTurnMandatory.session, 1));
    expect(getLuaRestoreLegalActions(restoredAfterTurnMandatory, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger"]);

    const opponentMandatory = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger");
    expect(opponentMandatory).toMatchObject({ player: 1, windowKind: "triggerBucket", triggerBucket: "opponentMandatory" });
    const afterOpponentMandatory = applyLuaRestoreAndAssert(restored, opponentMandatory!);
    expect(afterOpponentMandatory.state.chain).toHaveLength(2);
    expect(afterOpponentMandatory.state.pendingTriggers.map((trigger) => afterOpponentMandatory.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12200", "12500"]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const staleOpponentMandatory = applyLuaRestoreResponse(restored, opponentMandatory!);
    expect(staleOpponentMandatory.ok).toBe(false);
    expect(staleOpponentMandatory.error).toContain("Response is not currently legal");
    expect(staleOpponentMandatory.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleOpponentMandatory.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleOpponentMandatory.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleOpponentMandatory.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleOpponentMandatory.legalActions);

    const restoredAfterOpponentMandatory = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredAfterOpponentMandatory.restoreComplete, restoredAfterOpponentMandatory.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterOpponentMandatory.session.state.chain).toHaveLength(2);
    expect(restoredAfterOpponentMandatory.session.state.pendingTriggers.map((trigger) => restoredAfterOpponentMandatory.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12200", "12500"]);
    expect(getLuaRestoreLegalActions(restoredAfterOpponentMandatory, 1)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredAfterOpponentMandatory, 0)).toEqual(getDuelLegalActions(restoredAfterOpponentMandatory.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterOpponentMandatory, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterOpponentMandatory.session, 0));
    expect(getLuaRestoreLegalActions(restoredAfterOpponentMandatory, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);

    const turnOptionalDecline = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declineTrigger");
    expect(turnOptionalDecline).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    const afterTurnOptional = applyLuaRestoreAndAssert(restored, turnOptionalDecline!);
    expect(afterTurnOptional.state.pendingTriggers.map((trigger) => afterTurnOptional.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12500"]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const staleTurnOptionalDecline = applyLuaRestoreResponse(restored, turnOptionalDecline!);
    expect(staleTurnOptionalDecline.ok).toBe(false);
    expect(staleTurnOptionalDecline.error).toContain("Response is not currently legal");
    expect(staleTurnOptionalDecline.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTurnOptionalDecline.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleTurnOptionalDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleTurnOptionalDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTurnOptionalDecline.legalActions);

    const restoredAfterTurnOptional = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredAfterTurnOptional.restoreComplete, restoredAfterTurnOptional.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterTurnOptional.session.state.chain).toHaveLength(2);
    expect(restoredAfterTurnOptional.session.state.pendingTriggers.map((trigger) => restoredAfterTurnOptional.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12500"]);
    expect(getLuaRestoreLegalActions(restoredAfterTurnOptional, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredAfterTurnOptional, 1)).toEqual(getDuelLegalActions(restoredAfterTurnOptional.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredAfterTurnOptional, 1)).toEqual(getGroupedDuelLegalActions(restoredAfterTurnOptional.session, 1));
    expect(getLuaRestoreLegalActions(restoredAfterTurnOptional, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);

    const restoredOpponentDecline = getLuaRestoreLegalActions(restoredAfterTurnOptional, 1).find((action) => action.type === "declineTrigger");
    expect(restoredOpponentDecline).toMatchObject({ player: 1, windowKind: "triggerBucket", triggerBucket: "opponentOptional" });
    const resolvedFromRestored = applyLuaRestoreAndAssert(restoredAfterTurnOptional, restoredOpponentDecline!);
    expect(resolvedFromRestored.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(resolvedFromRestored.state.chain).toEqual([]);
    expect(resolvedFromRestored.state.pendingTriggers).toEqual([]);
    const restoredReplay = applyLuaRestoreResponse(restoredAfterTurnOptional, restoredOpponentDecline!);
    expect(restoredReplay.ok).toBe(false);
    expect(restoredReplay.error).toContain("Response is not currently legal");
    expect(restoredReplay.state.actionWindowId).toBe(restoredAfterTurnOptional.session.state.actionWindowId);
    expect(restoredReplay.legalActions).toEqual(getDuelLegalActions(restoredAfterTurnOptional.session, 0));
    expect(restoredReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredAfterTurnOptional.session, 0));
    expect(restoredReplay.legalActionGroups.flatMap((group) => group.actions)).toEqual(restoredReplay.legalActions);

    const opponentOptionalDecline = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "declineTrigger");
    expect(opponentOptionalDecline).toMatchObject({ player: 1, windowKind: "triggerBucket", triggerBucket: "opponentOptional" });
    const resolved = applyLuaRestoreAndAssert(restored, opponentOptionalDecline!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(resolved.state.chain).toEqual([]);
    expect(resolved.state.pendingTriggers).toEqual([]);

    const replay = applyLuaRestoreResponse(restored, opponentOptionalDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.host.messages).toEqual(["restored opponent mandatory bucket", "restored turn mandatory bucket"]);
  });
});

function luaSummonTriggerScript(code: number, type: "EFFECT_TYPE_TRIGGER_F" | "EFFECT_TYPE_TRIGGER_O", message: string): string {
  return `
  c${code}={}
  function c${code}.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(${type})
    e:SetCode(EVENT_SUMMON_SUCCESS)
    e:SetRange(LOCATION_HAND)
    e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
      Debug.Message("${message}")
    end)
    c:RegisterEffect(e)
  end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
