import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon-negated events", () => {
  it("queues summon-negated triggers when Duel.NegateSummon negates a Normal Summon", () => {
    const fixture = createNegatedSummonFixture(198, "EVENT_SUMMON_NEGATED", "normalSummonNegated", "normal summon negated");
    const summon = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === fixture.summoned.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(fixture.session, summon!).ok).toBe(true);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
  });

  it("queues flip-summon-negated triggers when Duel.NegateSummon negates a Flip Summon", () => {
    const fixture = createNegatedSummonFixture(199, "EVENT_FLIP_SUMMON_NEGATED", "flipSummonNegated", "flip summon negated");
    moveDuelCard(fixture.session.state, fixture.summoned.uid, "monsterZone", 0).position = "faceDownDefense";
    fixture.summoned.faceUp = false;
    const flip = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === fixture.summoned.uid);
    expect(flip).toBeDefined();
    expect(applyResponse(fixture.session, flip!).ok).toBe(true);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
  });

  it("queues special-summon-negated triggers when Duel.NegateSummon negates a Special Summon", () => {
    const fixture = createNegatedSummonFixture(197, "EVENT_SPSUMMON_NEGATED", "specialSummonNegated", "special summon negated");
    specialSummonDuelCard(fixture.session.state, fixture.summoned.uid, 0);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
    expect(fixture.session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["specialSummonNegated", "chainSolved"]);
  });
});

function createNegatedSummonFixture(seed: number, eventCode: string, expectedEvent: string, message: string): {
  session: ReturnType<typeof createDuel>;
  host: ReturnType<typeof createLuaScriptHost>;
  summoned: NonNullable<ReturnType<ReturnType<typeof createDuel>["state"]["cards"]["find"]>>;
} {
  const cards: DuelCardData[] = [
    { code: "100", name: "Negated Summon", kind: "monster" },
    { code: "200", name: "Summon Negator", kind: "monster" },
    { code: "300", name: "Negation Watcher", kind: "monster" },
  ];
  const session = createDuel({ seed, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200", "300"] },
    1: { main: [] },
  });
  startDuel(session);
  const summoned = session.state.cards.find((card) => card.code === "100");
  expect(summoned).toBeDefined();

  const host = createLuaScriptHost(session);
  const loaded = host.loadScript(
    `
    c200={}
    function c200.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
        Debug.Message("negated count " .. Duel.NegateSummon(g:GetFirst()))
      end)
      c:RegisterEffect(e)
    end

    c300={}
    function c300.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(${eventCode})
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("${message} " .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(e)
    end
    `,
    `${expectedEvent}.lua`,
  );
  expect(loaded.ok, loaded.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { session, host, summoned: summoned! };
}

function activateNegator(fixture: { session: ReturnType<typeof createDuel> }): void {
  const action = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("200"));
  expect(action).toBeDefined();
  expect(applyResponse(fixture.session, action!).ok).toBe(true);
}
