import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua return-to-grave events", () => {
  it("queues return-to-grave triggers when Lua returns a banished card to the Graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Source", kind: "monster" },
      { code: "200", name: "Return Target", kind: "monster" },
      { code: "300", name: "Return Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 204, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
          Debug.Message("banish count " .. Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY))
          Debug.Message("return count " .. Duel.ReturnToGrave(tc))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("return trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-grave-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const target = session.state.cards.find((card) => card.code === "200");
    expect(host.messages).toContain("banish count 1");
    expect(host.messages).toContain("return count 1");
    expect(target).toMatchObject({ location: "graveyard", reason: 0x20000 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["returnedToGraveyard"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1203, eventCardUid: target!.uid });
    expect(session.state.eventHistory).toEqual([
      expect.objectContaining({ eventName: "chainActivating", eventCode: 1021 }),
      expect.objectContaining({ eventName: "chaining", eventCode: 1027 }),
      expect.objectContaining({ eventName: "chainSolving", eventCode: 1020 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "banished", eventCode: 1011 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "returnedToGraveyard", eventCode: 1203 }),
      expect.objectContaining({ eventName: "chainSolved", eventCode: 1022 }),
    ]);
  });

  it("makes Lua optional when return-to-grave triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Boundary Source", kind: "monster" },
      { code: "200", name: "Return Boundary Target", kind: "monster" },
      { code: "300", name: "When Return Watcher", kind: "monster" },
      { code: "400", name: "If Return Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 265, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
          Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY)
          Duel.ReturnToGrave(tc)
          Duel.Damage(1, 100, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("when return resolved")
        end)
        c:RegisterEffect(e)
      end

      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("if return resolved")
        end)
        c:RegisterEffect(e)
      end

      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_DAMAGE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("damage boundary resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-grave-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1203");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1203", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "returnedToGraveyard", eventCode: 1203 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });
});
