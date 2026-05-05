import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua open fast priority restore", () => {
  it("activates restored open fast effects and rejects stale restored open actions", () => {
    const cards: DuelCardData[] = [
      { code: "18100", name: "Lua Restored Open Fast Source", kind: "monster" },
      { code: "18200", name: "Lua Restored Open Fast Quick", kind: "monster" },
      { code: "18300", name: "Lua Restored Open Fast Opponent Chain Quick", kind: "monster" },
      { code: "18400", name: "Lua Restored Open Fast Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c18100.lua") {
          return `
          c18100={}
          function c18100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast source resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c18200.lua") {
          return `
          c18200={}
          function c18200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c18300.lua") {
          return `
          c18300={}
          function c18300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast opponent chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 98, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["18100", "18200"] }, 1: { main: ["18300", "18400"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(18100, source).ok).toBe(true);
    expect(host.loadCardScript(18200, source).ok).toBe(true);
    expect(host.loadCardScript(18300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18100"));
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const chainPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(chainPass).toBeDefined();
    const opened = applyLuaRestoreResponse(restored, chainPass!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(opened.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const quick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18200"));
    expect(quick).toMatchObject({ player: 0, windowKind: "open" });
    const quickResult = applyLuaRestoreResponse(restored, quick!);
    expect(quickResult.ok, quickResult.error).toBe(true);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(quickResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(quickResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(quickResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(quickResult.legalActions);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const finalPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(finalPass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, finalPass!).ok).toBe(true);
    expect(restored.host.messages).toEqual(["restored open fast source resolved", "restored open fast quick resolved"]);
  });

  it("opens restored fast effects after restored trigger chains resolve", () => {
    const cards: DuelCardData[] = [
      { code: "19100", name: "Lua Restored Trigger Fast Summon", kind: "monster" },
      { code: "19200", name: "Lua Restored Trigger Fast Trigger", kind: "monster" },
      { code: "19300", name: "Lua Restored Trigger Fast Quick", kind: "monster" },
      { code: "19400", name: "Lua Restored Trigger Fast Chain Quick", kind: "monster" },
      { code: "19500", name: "Lua Restored Trigger Fast Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c19200.lua") {
          return `
          c19200={}
          function c19200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19300.lua") {
          return `
          c19300={}
          function c19300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19400.lua") {
          return `
          c19400={}
          function c19400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 99, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["19100", "19200", "19300"] }, 1: { main: ["19400", "19500", "19500"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(19200, source).ok).toBe(true);
    expect(host.loadCardScript(19300, source).ok).toBe(true);
    expect(host.loadCardScript(19400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "19100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(summoned.state.pendingTriggers.map((trigger) => trigger.effectId)).toHaveLength(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnMandatory" });
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok, triggerResult.error).toBe(true);
    expect(triggerResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const chainQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid.includes("19400"));
    expect(chainQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    const chainQuickResult = applyLuaRestoreResponse(restored, chainQuick!);
    expect(chainQuickResult.ok, chainQuickResult.error).toBe(true);
    expect(chainQuickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(chainQuickResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(chainQuickResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const opened = applyLuaRestoreResponse(restored, pass!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(opened.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const quick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("19300"));
    expect(quick).toMatchObject({ player: 0, windowKind: "open" });
    const quickResult = applyLuaRestoreResponse(restored, quick!);
    expect(quickResult.ok, quickResult.error).toBe(true);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const finalPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(finalPass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, finalPass!).ok).toBe(true);
    expect(restored.host.messages).toEqual(["restored trigger fast chain quick resolved", "restored trigger fast trigger resolved", "restored trigger fast quick resolved"]);
  });
});
