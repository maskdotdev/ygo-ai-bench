import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

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
    applyAndAssert(session, summon!);

    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const opened = applyAndAssert(session, trigger!);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).map((action) => action.type)).toEqual(["activateEffect", "passChain"]);

    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(quick).toBeDefined();
    const chained = applyAndAssert(session, quick!);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(0);

    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(session, pass!);
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
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12200", "12300"]);

    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    const opened = applyAndAssert(session, firstTrigger!);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(opened.state.pendingTriggers.map((trigger) => opened.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["12300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([opened.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const secondTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === opened.state.pendingTriggers[0]?.effectId);
    expect(secondTrigger).toBeDefined();
    applyAndAssert(session, secondTrigger!);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(session, pass!);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.pendingTriggers).toHaveLength(0);
    expect(host.messages).toEqual(["lua second held trigger resolved", "lua first held trigger resolved"]);
  });

  it("restores trigger-created Lua chain windows before fast responses resolve", () => {
    const cards: DuelCardData[] = [
      { code: "15100", name: "Lua Restored Chain Window Summon", kind: "monster" },
      { code: "15200", name: "Lua Restored First Trigger", kind: "monster" },
      { code: "15300", name: "Lua Restored Second Trigger", kind: "monster" },
      { code: "15400", name: "Lua Restored Opponent Quick", kind: "monster" },
      { code: "15500", name: "Lua Restored Chain Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c15200.lua") {
          return `
          c15200={}
          function c15200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored first trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c15300.lua") {
          return `
          c15300={}
          function c15300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored second trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c15400.lua") {
          return `
          c15400={}
          function c15400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored opponent quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 95, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["15100", "15200", "15300"] }, 1: { main: ["15400", "15500", "15500"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    loadCardScriptAndAssert(host, 15200, source);
    loadCardScriptAndAssert(host, 15300, source);
    loadCardScriptAndAssert(host, 15400, source);
    expect(host.registerInitialEffects()).toBe(3);

    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "15100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    applyAndAssert(session, firstTrigger!);
    const secondTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(secondTrigger).toBeDefined();
    const opened = applyAndAssert(session, secondTrigger!);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(session.state.chain.map((link) => link.effectId));
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const quick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect");
    expect(quick).toBeDefined();
    const quickResult = applyLuaRestoreAndAssert(restored, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(quickResult.state.chain).toHaveLength(3);
    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, 1);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    assertStaleLuaPreviousWindow(restored, pass!, 1);
    const passed = applyLuaRestoreAndAssert(restored, pass!);
    expect(passed.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.session.state.chainPasses).toEqual([]);
    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, stalePass.state.waitingFor!));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, stalePass.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored opponent quick resolved", "restored second trigger resolved", "restored first trigger resolved"]);
  });

  it("restores cross-player Lua trigger bucket progression while building a SEGOC chain", () => {
    const cards: DuelCardData[] = [
      { code: "16100", name: "Lua Restored Bucket Progression Summon", kind: "monster" },
      { code: "16200", name: "Lua Restored First Held Bucket", kind: "monster" },
      { code: "16300", name: "Lua Restored Opponent Held Bucket", kind: "monster" },
      { code: "16400", name: "Lua Restored Bucket Progression Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c16200.lua") {
          return `
          c16200={}
          function c16200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored turn mandatory resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c16300.lua") {
          return `
          c16300={}
          function c16300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored opponent mandatory resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 96, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["16100", "16200", "16400"] }, 1: { main: ["16300", "16400", "16400"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    loadCardScriptAndAssert(host, 16200, source);
    loadCardScriptAndAssert(host, 16300, source);
    expect(host.registerInitialEffects()).toBe(2);

    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "16100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["16200", "16300"]);
    expect(session.state.pendingTriggers.map((trigger) => trigger.player)).toEqual([0, 1]);

    const firstEffectId = session.state.pendingTriggers[0]?.effectId;
    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === firstEffectId);
    expect(firstTrigger).toBeDefined();
    applyAndAssert(session, firstTrigger!);
    expect(session.state.chain.map((link) => link.effectId)).toEqual([firstEffectId]);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["16300"]);
    const originalSecondTrigger = getDuelLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(originalSecondTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual([firstEffectId]);
    expect(restored.session.state.pendingTriggers.map((trigger) => restored.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["16300"]);
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(0);
    expect(restored.session.state.waitingFor).toBe(1);
    expect(getLuaRestoreLegalActions(restored, 0)).toHaveLength(0);
    expect(getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([restored.session.state.pendingTriggers[0]?.effectId]);
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasLuaRestoreGroupedTrigger(restored, 1, restored.session.state.pendingTriggers[0]!.effectId, "activateTrigger")).toBe(true);

    const secondTrigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.effectId === restored.session.state.pendingTriggers[0]?.effectId);
    expect(secondTrigger).toBeDefined();
    const originalSecondTriggerPreapply = applyLuaRestoreResponse(restored, originalSecondTrigger!);
    expect(originalSecondTriggerPreapply.ok).toBe(false);
    expect(originalSecondTriggerPreapply.error).toContain("Response is not currently legal");
    expect(originalSecondTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(originalSecondTriggerPreapply.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, originalSecondTriggerPreapply, 1);
    applyLuaRestoreAndAssert(restored, secondTrigger!);
    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.host.messages).toEqual(["restored opponent mandatory resolved", "restored turn mandatory resolved"]);
  });

  it("returns restored Lua SEGOC chain resolution to turn-player open fast priority", () => {
    const cards: DuelCardData[] = [
      { code: "17100", name: "Lua Restored Open Priority Summon", kind: "monster" },
      { code: "17200", name: "Lua Restored Open Priority Trigger", kind: "monster" },
      { code: "17300", name: "Lua Restored Open Priority Opponent Trigger", kind: "monster" },
      { code: "17400", name: "Lua Restored Open Priority Turn Quick", kind: "monster" },
      { code: "17500", name: "Lua Restored Open Priority Opponent Chain Quick", kind: "monster" },
      { code: "17600", name: "Lua Restored Open Priority Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c17200.lua") {
          return `
          c17200={}
          function c17200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored open turn trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c17300.lua") {
          return `
          c17300={}
          function c17300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored open opponent trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c17400.lua") {
          return `
          c17400={}
          function c17400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open turn quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c17500.lua") {
          return `
          c17500={}
          function c17500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open opponent chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["17100", "17200", "17400"] }, 1: { main: ["17300", "17500", "17600"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    loadCardScriptAndAssert(host, 17200, source);
    loadCardScriptAndAssert(host, 17300, source);
    loadCardScriptAndAssert(host, 17400, source);
    loadCardScriptAndAssert(host, 17500, source);
    expect(host.registerInitialEffects()).toBe(4);

    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "17100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    applyAndAssert(session, firstTrigger!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 1);
    const turnOpenQuickId = effectIdForSourceCode(restored.session, "17400");
    const opponentChainQuickId = effectIdForSourceCode(restored.session, "17500");
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.pendingTriggers.map((trigger) => restored.session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["17300"]);
    expect(restored.session.state.waitingFor).toBe(1);

    const opponentTriggerEffectId = restored.session.state.pendingTriggers[0]?.effectId;
    const opponentTrigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.effectId === opponentTriggerEffectId);
    expect(opponentTrigger).toBeDefined();
    expect(hasLuaRestoreGroupedTrigger(restored, 1, opponentTriggerEffectId!, "activateTrigger")).toBe(true);
    applyLuaRestoreAndAssert(restored, opponentTrigger!);
    expect(restored.session.state.waitingFor).toBe(1);
    expect(getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual([opponentChainQuickId]);
    expect(getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === opponentChainQuickId)).toMatchObject({ windowKind: "chainResponse" });
    expect(hasLuaRestoreGroupedEffect(restored, 1, opponentChainQuickId, "chainResponse")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateEffect")).toHaveLength(0);
    const originalRestoredOpponentQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === opponentChainQuickId);
    expect(originalRestoredOpponentQuick).toBeDefined();

    const restoredAfterOpponentTrigger = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredAfterOpponentTrigger.restoreComplete, restoredAfterOpponentTrigger.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAfterOpponentTrigger, 1);
    expect(restoredAfterOpponentTrigger.session.state.chain).toHaveLength(2);
    expect(restoredAfterOpponentTrigger.session.state.pendingTriggers).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 1).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual([opponentChainQuickId]);
    expect(getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 1).find((action) => action.type === "activateEffect" && action.effectId === opponentChainQuickId)).toMatchObject({ windowKind: "chainResponse" });
    expect(hasLuaRestoreGroupedEffect(restoredAfterOpponentTrigger, 1, opponentChainQuickId, "chainResponse")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 0).filter((action) => action.type === "activateEffect")).toHaveLength(0);

    const restoredOpponentQuick = getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 1).find((action) => action.type === "activateEffect" && action.effectId === opponentChainQuickId);
    expect(restoredOpponentQuick).toBeDefined();
    const originalRestoredOpponentQuickPreapply = applyLuaRestoreResponse(restoredAfterOpponentTrigger, originalRestoredOpponentQuick!);
    expect(originalRestoredOpponentQuickPreapply.ok).toBe(false);
    expect(originalRestoredOpponentQuickPreapply.error).toContain("Response is not currently legal");
    expect(originalRestoredOpponentQuickPreapply.legalActions).toEqual(getDuelLegalActions(restoredAfterOpponentTrigger.session, 1));
    const restoredQuickResult = applyLuaRestoreAndAssert(restoredAfterOpponentTrigger, restoredOpponentQuick!);
    expect(restoredQuickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 0).filter((action) => action.type === "activateEffect")).toHaveLength(0);
    const restoredPass = getLuaRestoreLegalActions(restoredAfterOpponentTrigger, 1).find((action) => action.type === "passChain");
    expect(restoredPass).toBeDefined();
    assertStaleLuaPreviousWindow(restoredAfterOpponentTrigger, restoredPass!, 1);
    const restoredPassed = applyLuaRestoreAndAssert(restoredAfterOpponentTrigger, restoredPass!);
    expect(restoredPassed.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restoredAfterOpponentTrigger.session.state.chainPasses).toEqual([]);
    expect(restoredPassed.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", effectId: turnOpenQuickId })]));
    expect(hasGroupedEffect(restoredPassed.legalActionGroups, 0, turnOpenQuickId, "open")).toBe(true);
    expect(getDuelLegalActions(restoredAfterOpponentTrigger.session, 1)).toEqual([]);
    expect(restoredAfterOpponentTrigger.host.messages).toEqual(["restored open opponent chain quick resolved", "restored open opponent trigger resolved", "restored open turn trigger resolved"]);

    const opponentQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === opponentChainQuickId);
    expect(opponentQuick).toBeDefined();
    applyLuaRestoreAndAssert(restored, opponentQuick!);
    expect(restored.session.state.waitingFor).toBe(1);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    assertStaleLuaPreviousWindow(restored, pass!, 1);
    const opponentPassed = applyLuaRestoreAndAssert(restored, pass!);
    expect(opponentPassed.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(opponentPassed.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(opponentPassed.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, opponentPassed, 0);
    expect(opponentPassed.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", effectId: turnOpenQuickId })]));
    expect(hasGroupedEffect(opponentPassed.legalActionGroups, 0, turnOpenQuickId, "open")).toBe(true);
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    expect(restored.host.messages).toEqual(["restored open opponent chain quick resolved", "restored open opponent trigger resolved", "restored open turn trigger resolved"]);
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
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13200", "13300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      session.state.pendingTriggers[0]?.effectId,
      session.state.pendingTriggers[1]?.effectId,
    ]);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstActivation).toBeDefined();
    const opened = applyAndAssert(session, firstActivation!);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(opened.state.pendingTriggers.map((trigger) => opened.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13300"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([opened.state.pendingTriggers[0]?.effectId]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    const staleActivation = applyResponse(session, firstActivation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(staleActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleActivation.legalActions);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["13300"]);

    const secondActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === opened.state.pendingTriggers[0]?.effectId);
    expect(secondActivation).toBeDefined();
    applyAndAssert(session, secondActivation!);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(session, pass!);
    expect(resolved.state.chain).toHaveLength(0);
    expect(session.state.chainPasses).toEqual([]);
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
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14200", "14300", "14400"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      session.state.pendingTriggers[0]?.effectId,
      session.state.pendingTriggers[1]?.effectId,
    ]);

    const firstDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(firstDecline).toBeDefined();
    const afterFirstDecline = applyAndAssert(session, firstDecline!);
    expect(afterFirstDecline.state.pendingTriggers.map((trigger) => afterFirstDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14300", "14400"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterFirstDecline.state.pendingTriggers[0]?.effectId]);
    const staleDecline = applyResponse(session, firstDecline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(staleDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleDecline.legalActions);
    expect(session.state.pendingTriggers.map((trigger) => session.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14300", "14400"]);

    const secondDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === afterFirstDecline.state.pendingTriggers[0]?.effectId);
    expect(secondDecline).toBeDefined();
    const afterSecondDecline = applyAndAssert(session, secondDecline!);
    expect(afterSecondDecline.state.pendingTriggers.map((trigger) => afterSecondDecline.state.cards.find((card) => card.uid === trigger.sourceUid)?.code)).toEqual(["14400"]);
    expect(afterSecondDecline.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([afterSecondDecline.state.pendingTriggers[0]?.effectId]);
    expect(host.messages).toEqual([]);
  });
});

function effectIdForSourceCode(session: ReturnType<typeof createDuel>, code: string): string {
  const effect = session.state.effects.find((candidate) => {
    const source = session.state.cards.find((card) => card.uid === candidate.sourceUid);
    return source?.code === code;
  });
  expect(effect).toBeDefined();
  return effect!.id;
}

function loadCardScriptAndAssert(host: ReturnType<typeof createLuaScriptHost>, code: number, source: Parameters<ReturnType<typeof createLuaScriptHost>["loadCardScript"]>[1]) {
  const loaded = host.loadCardScript(code, source);
  expect(loaded.ok, loaded.error).toBe(true);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function assertLuaRestoreLegalWindow(restored: Parameters<typeof applyLuaRestoreResponse>[0], response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1) {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function assertStaleLuaPreviousWindow(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: DuelResponse, player: 0 | 1): void {
  const beforeChainPasses = [...restored.session.state.chainPasses];
  const stale = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  expect(restored.session.state.chainPasses).toEqual(beforeChainPasses);
  assertLuaRestoreLegalWindow(restored, stale, player);
}

function hasLuaRestoreGroupedTrigger(
  restored: Parameters<typeof applyLuaRestoreResponse>[0],
  player: 0 | 1,
  effectId: string,
  actionType: "activateTrigger" | "declineTrigger",
): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some(
    (group) =>
      group.windowId === restored.session.state.actionWindowId &&
      group.windowKind === "triggerBucket" &&
      group.actions.some(
        (action) => action.type === actionType && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "triggerBucket",
      ),
  );
}

function hasLuaRestoreGroupedEffect(
  restored: Parameters<typeof applyLuaRestoreResponse>[0],
  player: 0 | 1,
  effectId: string,
  windowKind: "chainResponse" | "open",
): boolean {
  return hasGroupedEffect(getLuaRestoreLegalActionGroups(restored, player), player, effectId, windowKind);
}

function hasGroupedEffect(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
  windowKind: "chainResponse" | "open",
): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === windowKind),
  );
}
