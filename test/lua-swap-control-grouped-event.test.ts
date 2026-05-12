import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua SwapControl grouped events", () => {
  it("preserves active Lua reason source metadata for swapped cards and grouped control events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Swap Reason Self", kind: "monster", typeFlags: 0x21 },
      { code: "600", name: "Swap Reason Opponent", kind: "monster", typeFlags: 0x21 },
      { code: "700", name: "Swap Reason Watcher", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 121, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "700"] }, 1: { main: ["600"] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const selfTarget = session.state.cards.find((card) => card.code === "200");
    const opponentTarget = session.state.cards.find((card) => card.code === "600");
    expect(source).toBeDefined();
    expect(selfTarget).toBeDefined();
    expect(opponentTarget).toBeDefined();
    for (const card of [selfTarget!, opponentTarget!]) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
      card.position = "faceUpAttack";
      card.faceUp = true;
    }

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
          local self_target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local opponent_target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 600), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
          Debug.Message("swap reason result " .. tostring(Duel.SwapControl(self_target, opponent_target)))
          Debug.Message("swap reason self " .. tostring(self_target:GetReasonCard()==c) .. "/" .. tostring(self_target:GetReasonEffect()==source_effect))
          Debug.Message("swap reason opponent " .. tostring(opponent_target:GetReasonCard()==c) .. "/" .. tostring(opponent_target:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c700={}
      function c700.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CONTROL_CHANGED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local changed=eg:GetFirst()
          Debug.Message("swap event reason source " .. tostring(changed:GetReasonCard():IsCode(100)) .. "/" .. tostring(changed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "swap-control-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(expect.arrayContaining(["swap reason result true", "swap reason self true/true", "swap reason opponent true/true"]));
    expect(selfTarget).toMatchObject({ controller: 1, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(opponentTarget).toMatchObject({ controller: 0, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "controlChanged", eventCardUid: selfTarget!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("swap event reason source true/true");
  });

  it("collects one grouped EVENT_CONTROL_CHANGED event for paired swaps", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Swap Self", kind: "monster" },
      { code: "300", name: "Grouped Swap Watcher", kind: "monster" },
      { code: "600", name: "Grouped Swap Opponent", kind: "monster" },
    ];
    const session = createDuel({ seed: 108, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "300"] }, 1: { main: ["600"] } });
    startDuel(session);
    for (const code of ["200", "600"]) {
      const card = session.state.cards.find((candidate) => candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", card!.controller);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local self_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local self_trigger=Effect.CreateEffect(self_target)
      self_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      self_trigger:SetCode(EVENT_CONTROL_CHANGED)
      self_trigger:SetRange(LOCATION_MZONE)
      self_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("swap self group " .. eg:GetCount())
      end)
      self_target:RegisterEffect(self_trigger)

      local opponent_trigger=Effect.CreateEffect(opponent_target)
      opponent_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      opponent_trigger:SetCode(EVENT_CONTROL_CHANGED)
      opponent_trigger:SetRange(LOCATION_MZONE)
      opponent_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("swap opponent group " .. eg:GetCount())
      end)
      opponent_target:RegisterEffect(opponent_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_CONTROL_CHANGED)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("swap generic group " .. eg:GetCount())
      end)
      watcher:RegisterEffect(generic)

      Debug.Message("swap grouped " .. tostring(Duel.SwapControl(self_target, opponent_target)))
      `,
      "swap-control-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const selfTarget = session.state.cards.find((card) => card.code === "200");
    const opponentTarget = session.state.cards.find((card) => card.code === "600");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(host.messages).toContain("swap grouped true");
    expect(selfTarget).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(opponentTarget).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([selfTarget!.uid, opponentTarget!.uid]);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: selfTarget!.uid, eventCardUid: selfTarget!.uid }),
        expect.objectContaining({ sourceUid: opponentTarget!.uid, eventCardUid: opponentTarget!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: selfTarget!.uid }),
      ]),
    );

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["swap self group 2", "swap opponent group 2", "swap generic group 2"]));
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
