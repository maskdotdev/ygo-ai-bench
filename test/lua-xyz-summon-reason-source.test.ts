import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua Xyz Summon reason source", () => {
  it("preserves active Lua reason source metadata on Xyz materials and summoned monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Xyz Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Xyz Reason Material A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "201", name: "Xyz Reason Material B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "900", name: "Xyz Reason Monster", kind: "extra", typeFlags: 0x800001, level: 4, xyzMaterialCount: 2 },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    const otherMaterial = session.state.cards.find((card) => card.code === "201");
    const xyz = session.state.cards.find((card) => card.code === "900");
    expect(source).toBeDefined();
    expect(material).toBeDefined();
    expect(otherMaterial).toBeDefined();
    expect(xyz).toBeDefined();
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
          local xyz=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 900), tp, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
          local materials=Duel.SelectMatchingCard(tp, function(tc) return tc:IsCode(200) or tc:IsCode(201) end, tp, LOCATION_MZONE, 0, 2, 2, xyz)
          Debug.Message("xyz reason result " .. Duel.XyzSummon(xyz, materials))
          local rc=xyz:GetReasonCard()
          Debug.Message("xyz reason summoned " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(xyz:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "xyz-summon-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("xyz reason result 1");
    expect(host.messages).toContain("xyz reason summoned true/true");
    const movedMaterial = session.state.cards.find((card) => card.uid === material!.uid);
    const summonedXyz = session.state.cards.find((card) => card.uid === xyz!.uid);
    expect(movedMaterial).toMatchObject({ location: "overlay", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(summonedXyz).toMatchObject({ location: "monsterZone", summonType: "xyz", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(summonedXyz!.overlayUids).toContain(material!.uid);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: xyz!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
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
