import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua Synchro Summon reason source", () => {
  it("preserves active Lua reason source metadata on Synchro materials and summoned monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Synchro Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Synchro Reason Tuner", kind: "monster", typeFlags: 0x1001, level: 2 },
      { code: "201", name: "Synchro Reason Non-Tuner", kind: "monster", typeFlags: 0x1, level: 3 },
      { code: "900", name: "Synchro Reason Monster", kind: "extra", typeFlags: 0x2001, level: 5 },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const tuner = session.state.cards.find((card) => card.code === "200");
    const nonTuner = session.state.cards.find((card) => card.code === "201");
    const synchro = session.state.cards.find((card) => card.code === "900");
    expect(source).toBeDefined();
    expect(tuner).toBeDefined();
    expect(nonTuner).toBeDefined();
    expect(synchro).toBeDefined();
    moveDuelCard(session.state, tuner!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, nonTuner!.uid, "monsterZone", 0).position = "faceUpAttack";

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
          local synchro=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 900), tp, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
          local materials=Duel.SelectMatchingCard(tp, function(tc) return tc:IsCode(200) or tc:IsCode(201) end, tp, LOCATION_MZONE, 0, 2, 2, synchro)
          Debug.Message("synchro reason result " .. Duel.SynchroSummon(synchro, materials))
          local rc=synchro:GetReasonCard()
          Debug.Message("synchro reason summoned " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(synchro:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "synchro-summon-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("synchro reason result 1");
    expect(host.messages).toContain("synchro reason summoned true/true");
    expect(tuner).toMatchObject({ location: "graveyard", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(synchro).toMatchObject({ location: "monsterZone", summonType: "synchro", reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: synchro!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
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
