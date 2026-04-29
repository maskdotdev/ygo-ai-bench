import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

function setupLuaCountLimitTriggerFixture(seed: number, codes: { first: string; trigger: string; second: string }, countLimitArgs: string, message: string) {
  const cards: DuelCardData[] = [
    { code: codes.first, name: "Lua Count First Summon", kind: "monster" },
    { code: codes.trigger, name: "Lua Count Trigger", kind: "monster" },
    { code: codes.second, name: "Lua Count Second Summon", kind: "monster" },
  ];
  const session = createDuel({ seed, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: [codes.first, codes.trigger, codes.second] },
    1: { main: [codes.first, codes.first, codes.first] },
  });
  startDuel(session);

  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    c${codes.trigger}={}
    function c${codes.trigger}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCountLimit(${countLimitArgs})
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("${message}")
      end)
      c:RegisterEffect(e)
    end
    `,
    `lua-trigger-count-limit-${codes.trigger}.lua`,
  );

  expect(result.ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const firstSummon = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === codes.first);
  const secondSummon = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === codes.second);
  expect(firstSummon).toBeDefined();
  expect(secondSummon).toBeDefined();

  return { session, host, firstSummon: firstSummon!, secondSummon: secondSummon!, message };
}

function activateOnlyPendingTrigger(session: ReturnType<typeof createDuel>): void {
  expect(session.state.pendingTriggers).toHaveLength(1);
  const effectId = session.state.pendingTriggers[0]!.effectId;
  const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === effectId);
  expect(trigger).toBeDefined();
  expect(applyResponse(session, trigger!).ok).toBe(true);
}

describe("Lua trigger count limits", () => {
  it("suppresses Lua trigger effects after SetCountLimit is used", () => {
    const fixture = setupLuaCountLimitTriggerFixture(91, { first: "11100", trigger: "11200", second: "11300" }, "1", "count limited trigger");

    specialSummonDuelCard(fixture.session.state, fixture.firstSummon.uid);
    activateOnlyPendingTrigger(fixture.session);
    expect(fixture.session.state.usedCountKeys).toHaveLength(1);

    specialSummonDuelCard(fixture.session.state, fixture.secondSummon.uid);
    expect(fixture.session.state.pendingTriggers).toHaveLength(0);
    expect(fixture.session.state.usedCountKeys).toHaveLength(1);
    expect(fixture.host.messages.filter((message) => message === fixture.message)).toHaveLength(1);
  });

  it("allows Lua turn-scoped trigger count limits again on a later turn", () => {
    const fixture = setupLuaCountLimitTriggerFixture(93, { first: "13100", trigger: "13200", second: "13300" }, "1", "turn count limited trigger");

    specialSummonDuelCard(fixture.session.state, fixture.firstSummon.uid);
    activateOnlyPendingTrigger(fixture.session);
    expect(fixture.session.state.usedCountKeys).toHaveLength(1);

    fixture.session.state.turn += 1;
    fixture.session.state.waitingFor = 0;
    specialSummonDuelCard(fixture.session.state, fixture.secondSummon.uid);
    activateOnlyPendingTrigger(fixture.session);

    expect(fixture.session.state.usedCountKeys).toHaveLength(2);
    expect(new Set(fixture.session.state.usedCountKeys).size).toBe(2);
    expect(fixture.host.messages.filter((message) => message === fixture.message)).toHaveLength(2);
  });

  it("keeps Lua duel-scoped trigger count codes spent across later turns", () => {
    const fixture = setupLuaCountLimitTriggerFixture(92, { first: "12100", trigger: "12200", second: "12300" }, "1, 0x302", "duel count limited trigger");

    specialSummonDuelCard(fixture.session.state, fixture.firstSummon.uid);
    activateOnlyPendingTrigger(fixture.session);
    expect(fixture.session.state.usedCountKeys).toEqual(["duel:0:code-770"]);

    fixture.session.state.turn += 1;
    fixture.session.state.waitingFor = 0;
    specialSummonDuelCard(fixture.session.state, fixture.secondSummon.uid);

    expect(fixture.session.state.pendingTriggers).toHaveLength(0);
    expect(fixture.session.state.usedCountKeys).toEqual(["duel:0:code-770"]);
    expect(fixture.host.messages.filter((message) => message === fixture.message)).toHaveLength(1);
  });
});
