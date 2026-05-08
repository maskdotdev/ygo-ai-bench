import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only equip events", () => {
  it("binds EVENT_EQUIP single triggers only to the equipped source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Source-Only Target", kind: "monster" },
      { code: "500", name: "Equip Source-Only Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "700", name: "Equip Generic Watcher", kind: "monster" },
      { code: "701", name: "Unequipped Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 118, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500", "700", "701"] }, 1: { main: [] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 701), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(equip)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_EQUIP)
      source_trigger:SetRange(LOCATION_SZONE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source equip single " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      end)
      equip:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_EQUIP)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic equip " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_EQUIP)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong equip single " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("equip source-only " .. tostring(Duel.Equip(0, equip, target)))
      `,
      "equip-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const equip = session.state.cards.find((card) => card.code === "500");
    const genericWatcher = session.state.cards.find((card) => card.code === "700");
    const singleWatcher = session.state.cards.find((card) => card.code === "701");
    expect(host.messages).toContain("equip source-only true");
    const equipTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "equipped");
    expect(equipTriggers).toHaveLength(2);
    expect(equipTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: equip!.uid, eventCardUid: equip!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: equip!.uid }),
      ]),
    );
    expect(equipTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["source equip single 1/500", "generic equip 1/500"]));
    expect(host.messages).not.toContain("wrong equip single 1");
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
