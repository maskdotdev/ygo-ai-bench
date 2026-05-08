import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only become-target events", () => {
  it("binds EVENT_BECOME_TARGET single triggers only to the targeted source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeting Source", kind: "monster" },
      { code: "200", name: "Source-Only Targeted Card", kind: "monster" },
      { code: "300", name: "Become Target Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Become Target Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 124, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local activator=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local activate=Effect.CreateEffect(activator)
      activate:SetType(EFFECT_TYPE_IGNITION)
      activate:SetRange(LOCATION_HAND)
      activate:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
        end
        Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
        return true
      end)
      activate:SetOperation(function(e,tp)
        Debug.Message("targeting effect resolved " .. Duel.GetFirstTarget():GetCode())
      end)
      activator:RegisterEffect(activate)

      local source_trigger=Effect.CreateEffect(target)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_BECOME_TARGET)
      source_trigger:SetRange(LOCATION_HAND)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source become target " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      target:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_BECOME_TARGET)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic become target " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_BECOME_TARGET)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong become target " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "become-target-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const target = session.state.cards.find((card) => card.code === "200");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(target).toBeDefined();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("targeting effect resolved 200");

    const targetTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "becameTarget");
    expect(targetTriggers).toHaveLength(2);
    expect(targetTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: target!.uid, eventCardUid: target!.uid, eventCode: 1028 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: target!.uid, eventCode: 1028 }),
      ]),
    );
    expect(targetTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["source become target 1/200", "generic become target 1/200"]));
    expect(host.messages).not.toContain("wrong become target 1");
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
