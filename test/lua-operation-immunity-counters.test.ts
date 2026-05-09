import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

function placeOpponentMonster(session: ReturnType<typeof createDuel>, code: string): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", 1);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

function addCounter(session: ReturnType<typeof createDuel>, code: string, counterType: number): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  expect(addDuelCardCounter(card!, counterType, 1)).toBe(true);
}

describe("Lua operation immunity counters", () => {
  it("blocks effect counter changes on immune cards while allowing costs and ignore-immune effects", () => {
    const cards: DuelCardData[] = [
      { code: "166", name: "Counter Source", kind: "monster" },
      { code: "167", name: "Ignore Counter Source", kind: "monster" },
      { code: "290", name: "Immune Counter Target", kind: "monster" },
      { code: "291", name: "Immune Counter Cost Target", kind: "monster" },
      { code: "292", name: "Immune Duel Counter Target", kind: "monster" },
      { code: "293", name: "Immune Duel Counter Cost Target", kind: "monster" },
      { code: "390", name: "Open Counter Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 226, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["166", "167"] },
      1: { main: ["290", "291", "292", "293", "390"] },
    });
    startDuel(session);
    for (const code of ["290", "291", "292", "293", "390"]) placeOpponentMonster(session, code);
    addCounter(session, "290", 99);
    addCounter(session, "291", 99);
    addCounter(session, "292", 88);
    addCounter(session, "293", 77);
    addCounter(session, "390", 99);
    addCounter(session, "390", 66);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function pick(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function register_immune(c)
        c:EnableCounterPermit(99)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c166={}
      function c166.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected=pick(290)
          local protected_cost=pick(291)
          local duel_protected=pick(292)
          local duel_cost=pick(293)
          local open=pick(390)
          open:EnableCounterPermit(99)
          Debug.Message("counter add protected " .. tostring(protected:AddCounter(99,1)) .. "/" .. protected:GetCounter(99))
          Debug.Message("counter remove protected " .. tostring(protected:RemoveCounter(tp,99,1,REASON_EFFECT)) .. "/" .. protected:GetCounter(99))
          Debug.Message("counter remove cost " .. tostring(protected_cost:RemoveCounter(tp,99,1,REASON_COST)) .. "/" .. protected_cost:GetCounter(99))
          Debug.Message("counter add open " .. tostring(open:AddCounter(99,1)) .. "/" .. open:GetCounter(99))
          Debug.Message("counter remove open " .. tostring(open:RemoveCounter(tp,99,1,REASON_EFFECT)) .. "/" .. open:GetCounter(99))
          Debug.Message("duel counter protected " .. Duel.RemoveCounter(tp,0,LOCATION_MZONE,88,1,REASON_EFFECT) .. "/" .. duel_protected:GetCounter(88))
          Debug.Message("duel counter open " .. Duel.RemoveCounter(tp,0,LOCATION_MZONE,66,1,REASON_EFFECT) .. "/" .. open:GetCounter(66))
          Debug.Message("duel counter cost " .. Duel.RemoveCounter(tp,0,LOCATION_MZONE,77,1,REASON_COST) .. "/" .. duel_cost:GetCounter(77))
        end)
        c:RegisterEffect(e)
      end
      c167={}
      function c167.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected=pick(290)
          local duel_protected=pick(292)
          Debug.Message("ignore counter add protected " .. tostring(protected:AddCounter(99,1)) .. "/" .. protected:GetCounter(99))
          Debug.Message("ignore counter remove protected " .. tostring(protected:RemoveCounter(tp,99,1,REASON_EFFECT)) .. "/" .. protected:GetCounter(99))
          Debug.Message("ignore duel counter protected " .. Duel.RemoveCounter(tp,0,LOCATION_MZONE,88,1,REASON_EFFECT) .. "/" .. duel_protected:GetCounter(88))
        end)
        c:RegisterEffect(e)
      end
      c290={initial_effect=register_immune}
      c291={initial_effect=register_immune}
      c292={initial_effect=register_immune}
      c293={initial_effect=register_immune}
      `,
      "operation-immunity-counters.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(6);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "166");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "167");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    for (const message of [
      "counter add protected false/1",
      "counter remove protected false/1",
      "counter remove cost true/0",
      "counter add open true/2",
      "counter remove open true/1",
      "duel counter protected 0/1",
      "duel counter open 1/0",
      "duel counter cost 1/0",
    ]) {
      expect(host.messages).toContain(message);
    }

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    for (const message of [
      "ignore counter add protected true/2",
      "ignore counter remove protected true/1",
      "ignore duel counter protected 1/0",
    ]) {
      expect(host.messages).toContain(message);
    }
  });
});
