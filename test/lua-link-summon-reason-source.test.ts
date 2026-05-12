import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua Link Summon reason source", () => {
  it("preserves active Lua reason source metadata on Link materials and summoned monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Link Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Link Reason Material A", kind: "monster", typeFlags: 0x1 },
      { code: "201", name: "Link Reason Material B", kind: "monster", typeFlags: 0x1 },
      { code: "900", name: "Link Reason Monster", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterialMin: 2 },
    ];
    const session = createDuel({ seed: 124, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    const otherMaterial = session.state.cards.find((card) => card.code === "201");
    const link = session.state.cards.find((card) => card.code === "900");
    expect(source).toBeDefined();
    expect(material).toBeDefined();
    expect(otherMaterial).toBeDefined();
    expect(link).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, otherMaterial!.uid, "monsterZone", 0).position = "faceUpAttack";

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
          local link=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 900), tp, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
          local materials=Duel.SelectMatchingCard(tp, function(tc) return tc:IsCode(200) or tc:IsCode(201) end, tp, LOCATION_MZONE, 0, 2, 2, link)
          Debug.Message("link reason result " .. Duel.LinkSummon(link, materials))
          local rc=link:GetReasonCard()
          Debug.Message("link reason summoned " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(link:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "link-summon-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("link reason result 1");
    expect(host.messages).toContain("link reason summoned true/true");
    expect(material).toMatchObject({ location: "graveyard", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(link).toMatchObject({ location: "monsterZone", summonType: "link", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: link!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
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
