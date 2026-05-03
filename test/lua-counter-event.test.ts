import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua counter events", () => {
  it("queues add-counter triggers when Lua adds counters to a card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Counter Source", kind: "monster" },
      { code: "200", name: "Counter Target", kind: "monster" },
      { code: "300", name: "Counter Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 198, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
          Debug.Message("add counter " .. tostring(tc:AddCounter(99,1)))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_ADD_COUNTER)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("counter added " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "counter-add-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("add counter true");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["counterAdded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: target!.uid, eventCode: 0x10000 });
    expect(session.state.eventHistory.map((event) => event.eventName)).toEqual(["chainActivating", "chaining", "chainSolving", "counterAdded", "chainSolved"]);
    expect(session.state.eventHistory.find((event) => event.eventName === "counterAdded")).toMatchObject({ eventCode: 0x10000 });
  });

  it("queues remove-counter triggers when Lua removes counters from the field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Counter Remover", kind: "monster" },
      { code: "200", name: "Counter Holder", kind: "monster" },
      { code: "300", name: "Remove Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 199, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    expect(addDuelCardCounter(target, 99, 1)).toBe(true);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("remove counter " .. Duel.RemoveCounter(tp,1,0,99,1,REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_REMOVE_COUNTER)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("counter removed " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "counter-remove-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("remove counter 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["counterRemoved"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: target!.uid, eventCode: 0x20000 });
    expect(session.state.eventHistory.map((event) => event.eventName)).toEqual(["chainActivating", "chaining", "chainSolving", "counterRemoved", "chainSolved"]);
    expect(session.state.eventHistory.find((event) => event.eventName === "counterRemoved")).toMatchObject({ eventCode: 0x20000 });
  });
});
