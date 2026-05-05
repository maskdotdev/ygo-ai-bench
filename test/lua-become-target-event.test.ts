import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua become-target events", () => {
  it("queues Lua become-target triggers after activation targets are selected", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeting Source", kind: "monster" },
      { code: "200", name: "Targeted Card", kind: "monster" },
      { code: "300", name: "Target Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 179, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
          end
          Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          return true
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("targeting effect resolved " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BECOME_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("become target resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "become-target-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("targeting effect resolved 200");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["becameTarget"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1028, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("become target resolved 200");
  });

  it("makes Lua optional when become-target triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Boundary Source", kind: "monster" },
      { code: "200", name: "Target Boundary Card", kind: "monster" },
      { code: "300", name: "When Target Watcher", kind: "monster" },
      { code: "400", name: "If Target Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 187, startingHandSize: 5, cardReader: createCardReader(cards) });
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
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
          end
          Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          return true
        end)
        e:SetOperation(function(e,tp)
          Duel.Damage(1, 100, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BECOME_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("when target resolved")
        end)
        c:RegisterEffect(e)
      end

      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BECOME_TARGET)
        e:SetProperty(EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("if target resolved")
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
      "become-target-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1028");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1028", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "becameTarget", eventCode: 1028 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });
});
