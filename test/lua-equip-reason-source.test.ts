import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua equip reason source", () => {
  it("preserves active Lua reason source metadata for Duel.Equip", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Duel Equip Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Duel Equip Reason Target", kind: "monster", typeFlags: 0x21 },
      { code: "500", name: "Duel Equip Reason Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "700", name: "Duel Equip Reason Watcher", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "500", "700"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const equip = session.state.cards.find((card) => card.code === "500");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(equip).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local equip=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 500), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Debug.Message("duel equip reason result " .. tostring(Duel.Equip(tp, equip, target)))
          Debug.Message("duel equip reason source " .. tostring(equip:GetReasonCard()==c) .. "/" .. tostring(equip:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c700={}
      function c700.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_EQUIP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local equipped=eg:GetFirst()
          Debug.Message("duel equip event reason source " .. tostring(equipped:GetReasonCard():IsCode(100)) .. "/" .. tostring(equipped:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "duel-equip-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("duel equip reason result true");
    expect(host.messages).toContain("duel equip reason source true/true");
    expect(equip).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "equipped", eventCardUid: equip!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("duel equip event reason source true/true");
  });

  it("preserves active Lua reason source metadata for Card equip helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Equip Reason Target", kind: "monster", typeFlags: 0x21 },
      { code: "500", name: "Equip Reason Card", kind: "monster", typeFlags: 0x21 },
      { code: "700", name: "Equip Reason Watcher", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 119, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "500", "700"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const equip = session.state.cards.find((card) => card.code === "500");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(equip).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local equip=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 500), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Debug.Message("card equip reason result " .. tostring(target:EquipByEffectAndLimitRegister(e, tp, equip, 777003, true)))
          Debug.Message("card equip reason source " .. tostring(equip:GetReasonCard()==c) .. "/" .. tostring(equip:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c700={}
      function c700.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_EQUIP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local equipped=eg:GetFirst()
          Debug.Message("card equip event reason source " .. tostring(equipped:GetReasonCard():IsCode(100)) .. "/" .. tostring(equipped:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "card-equip-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("card equip reason result true");
    expect(host.messages).toContain("card equip reason source true/true");
    expect(equip).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "equipped", eventCardUid: equip!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("card equip event reason source true/true");
  });
});

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
