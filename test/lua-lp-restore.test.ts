import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua LP restore helpers", () => {
  it("applies restored Lua recover triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Recover Starter", kind: "monster" },
      { code: "200", name: "Restore Recover Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Debug.Message("recover applied " .. Duel.Recover(0, 900, REASON_EFFECT))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_RECOVER)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev)
              Debug.Message("restored recover trigger " .. ep .. "/" .. ev .. "/" .. Duel.GetLP(0))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 63, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    session.state.players[0].lifePoints = 6500;

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("recover applied 900");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["recoveredLifePoints"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1112, eventPlayer: 0, eventValue: 900 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["recoveredLifePoints"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1112, eventPlayer: 0, eventValue: 900 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored recover trigger 0/900/7400");
  });

  it("applies restored Lua LP-cost triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Cost Starter", kind: "monster" },
      { code: "200", name: "Restore Cost Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Duel.PayLPCost(0, 600)
              Debug.Message("cost paid " .. Duel.GetLP(0))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_PAY_LPCOST)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev)
              Debug.Message("restored cost trigger " .. ep .. "/" .. ev .. "/" .. Duel.GetLP(0))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 64, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("cost paid 7400");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["lifePointCostPaid"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1201, eventPlayer: 0, eventValue: 600 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["lifePointCostPaid"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1201, eventPlayer: 0, eventValue: 600 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored cost trigger 0/600/7400");
  });
});
