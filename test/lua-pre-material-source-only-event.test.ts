import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only pre-material events", () => {
  it("binds EVENT_BE_PRE_MATERIAL single triggers only to the material source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Pre-Material Fusion Material", kind: "monster" },
      { code: "300", name: "Pre-Material Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Pre-Material Single Watcher", kind: "monster" },
      { code: "900", name: "Source-Only Pre-Material Fusion", kind: "extra", fusionMaterials: ["100"] },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(material)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_BE_PRE_MATERIAL)
      source_trigger:SetRange(LOCATION_HAND)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source pre material single " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      material:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_BE_PRE_MATERIAL)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic pre material " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_BE_PRE_MATERIAL)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong pre material single " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "pre-material-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const material = session.state.cards.find((card) => card.code === "100");
    const fusion = session.state.cards.find((card) => card.code === "900");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(material).toBeDefined();
    expect(fusion).toBeDefined();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    const preMaterialTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "preUsedAsMaterial");
    expect(preMaterialTriggers).toHaveLength(2);
    expect(preMaterialTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: material!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
      ]),
    );
    expect(preMaterialTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["source pre material single 1/100", "generic pre material 1/100"]));
    expect(host.messages).not.toContain("wrong pre material single 1");
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
