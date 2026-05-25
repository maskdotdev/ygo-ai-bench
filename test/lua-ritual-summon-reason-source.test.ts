import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua Ritual Summon reason source", () => {
  it("preserves active Lua reason source metadata on selected Ritual materials and summoned monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ritual Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Ritual Reason Material", kind: "monster", typeFlags: 0x1 },
      { code: "900", name: "Ritual Reason Monster", kind: "monster", typeFlags: 0x81 },
    ];
    const session = createDuel({ seed: 121, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "900"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    const ritual = session.state.cards.find((card) => card.code === "900");
    expect(source).toBeDefined();
    expect(material).toBeDefined();
    expect(ritual).toBeDefined();

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
          local ritual=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 900), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          local material=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, ritual)
          Debug.Message("ritual reason result " .. Duel.RitualSummon(ritual, material))
          local rc=ritual:GetReasonCard()
          Debug.Message("ritual reason summoned " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(ritual:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "ritual-summon-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("ritual reason result 1");
    expect(host.messages).toContain("ritual reason summoned true/true");
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", summonType: "ritual", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: ritual!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
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
