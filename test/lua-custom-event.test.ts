import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua custom events", () => {
  it("matches raised EVENT_CUSTOM codes by their full numeric event code", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Custom Target", kind: "monster" },
      { code: "200", name: "Custom Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 202, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CUSTOM+7)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("custom trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "custom-event-register.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      Duel.RaiseEvent(target,EVENT_CUSTOM+7,nil,REASON_EFFECT,0,0,0)
      Debug.Message("custom check " .. tostring(Duel.CheckEvent(EVENT_CUSTOM+7)) .. "/" .. tostring(Duel.CheckEvent(EVENT_CUSTOM+8)))
      `,
      "custom-event-raise.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const eventCode = 0x10000000 + 7;
    const target = session.state.cards.find((card) => card.code === "100");
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "customEvent", eventCode, eventCardUid: target?.uid })]));
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "customEvent", eventCode, eventCardUid: target?.uid });
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "customEvent", eventCode, eventCardUid: target?.uid })]));
    expect(restored.state.pendingTriggers).toEqual([]);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("custom check true/false");
    expect(host.messages).toContain("custom trigger 100");
  });

  it("applies restored Lua custom-event triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Custom Target", kind: "monster" },
      { code: "200", name: "Restore Custom Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_CUSTOM+7)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored custom trigger " .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 204, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const raised = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      Duel.RaiseEvent(target,EVENT_CUSTOM+7,nil,REASON_EFFECT,1,0,77)
      `,
      "custom-event-restore-raise.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const eventCode = 0x10000000 + 7;
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "customEvent", eventCode, eventCardUid: target!.uid, eventPlayer: 0, eventValue: 77, eventReason: 64, eventReasonPlayer: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventName: "customEvent", eventCode, eventCardUid: target!.uid, eventPlayer: 0, eventValue: 77, eventReason: 64, eventReasonPlayer: 1 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyLuaRestoreResponse(restored, trigger!).ok).toBe(true);
    expect(restored.host.messages).toContain("restored custom trigger 100/0/77/64/1");
  });
});
