import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
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

function setupLuaSharedCountTriggerFixture(options: { seed: number; codes: { summon: string; first: string; second: string }; triggerType: string; countCode: string; messages: [string, string] }) {
  const cards: DuelCardData[] = [
    { code: options.codes.summon, name: "Lua Shared Count Summon", kind: "monster" },
    { code: options.codes.first, name: "Lua Shared Count First Trigger", kind: "monster" },
    { code: options.codes.second, name: "Lua Shared Count Second Trigger", kind: "monster" },
  ];
  const session = createDuel({ seed: options.seed, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: [options.codes.summon, options.codes.first, options.codes.second] },
    1: { main: [options.codes.summon, options.codes.summon, options.codes.summon] },
  });
  startDuel(session);

  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    c${options.codes.first}={}
    function c${options.codes.first}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(${options.triggerType})
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCountLimit(1, ${options.countCode})
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("${options.messages[0]}")
      end)
      c:RegisterEffect(e)
    end
    c${options.codes.second}={}
    function c${options.codes.second}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(${options.triggerType})
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetCountLimit(1, ${options.countCode})
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("${options.messages[1]}")
      end)
      c:RegisterEffect(e)
    end
    `,
    `lua-trigger-shared-count-${options.codes.first}.lua`,
  );

  expect(result.ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const summon = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === options.codes.summon);
  expect(summon).toBeDefined();

  return { session, host, summon: summon!, messages: options.messages };
}

function activateOnlyPendingTrigger(session: ReturnType<typeof createDuel>): void {
  expect(session.state.pendingTriggers).toHaveLength(1);
  const effectId = session.state.pendingTriggers[0]!.effectId;
  const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === effectId);
  expect(trigger).toBeDefined();
  applyAndAssert(session, trigger!);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
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

  it("shares Lua count codes across multiple trigger effects", () => {
    const fixture = setupLuaSharedCountTriggerFixture({
      seed: 94,
      codes: { summon: "14100", first: "14200", second: "14300" },
      triggerType: "EFFECT_TYPE_TRIGGER_O",
      countCode: "0x444",
      messages: ["first shared count trigger", "second shared count trigger"],
    });

    specialSummonDuelCard(fixture.session.state, fixture.summon.uid);
    expect(fixture.session.state.pendingTriggers).toHaveLength(2);
    const firstTrigger = getDuelLegalActions(fixture.session, 0).find((action) => action.type === "activateTrigger" && action.effectId === fixture.session.state.pendingTriggers[0]?.effectId);
    const staleSecondTrigger = getDuelLegalActions(fixture.session, 0).find((action) => action.type === "activateTrigger" && action.effectId === fixture.session.state.pendingTriggers[1]?.effectId);
    expect(firstTrigger).toBeDefined();
    expect(staleSecondTrigger).toBeDefined();
    applyAndAssert(fixture.session, firstTrigger!);

    expect(fixture.session.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);
    expect(fixture.session.state.pendingTriggers).toHaveLength(1);
    expect(getDuelLegalActions(fixture.session, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(0);
    expect(applyResponse(fixture.session, staleSecondTrigger!).ok).toBe(false);
    const declineSecond = getDuelLegalActions(fixture.session, 0).find((action) => action.type === "declineTrigger");
    expect(declineSecond).toBeDefined();
    applyAndAssert(fixture.session, declineSecond!);
    expect(fixture.host.messages).toContain(fixture.messages[0]);
    expect(fixture.host.messages).not.toContain(fixture.messages[1]);
  });

  it("parses table count codes as shared per-card variants", () => {
    const fixture = setupLuaSharedCountTriggerFixture({
      seed: 96,
      codes: { summon: "16100", first: "16200", second: "16300" },
      triggerType: "EFFECT_TYPE_TRIGGER_O",
      countCode: "{16200, 1}",
      messages: ["first table shared count trigger", "second table shared count trigger"],
    });

    const codes = fixture.session.state.effects.map((effect) => effect.countLimitCode);
    expect(codes).toEqual([16200 * 0x1000 + 0x10, 16200 * 0x1000 + 0x10]);

    specialSummonDuelCard(fixture.session.state, fixture.summon.uid);
    expect(fixture.session.state.pendingTriggers).toHaveLength(2);
    const firstTrigger = getDuelLegalActions(fixture.session, 0).find((action) => action.type === "activateTrigger" && action.effectId === fixture.session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    applyAndAssert(fixture.session, firstTrigger!);

    expect(fixture.session.state.usedCountKeys).toEqual([`turn-1:0:code-${16200 * 0x1000 + 0x10}`]);
    expect(getDuelLegalActions(fixture.session, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(0);
  });

  it("keeps table count-code variants distinct", () => {
    const cards: DuelCardData[] = [
      { code: "17100", name: "Lua Table Count Summon", kind: "monster" },
      { code: "17200", name: "Lua Table Count Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["17100", "17200"] },
      1: { main: ["17100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c17200={}
      function c17200.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_TRIGGER_O)
        e1:SetCode(EVENT_SPSUMMON_SUCCESS)
        e1:SetRange(LOCATION_HAND)
        e1:SetCountLimit(1,{17200,1})
        c:RegisterEffect(e1)
        local e2=e1:Clone()
        e2:SetCountLimit(1,{17200,2})
        c:RegisterEffect(e2)
      end
      `,
      "lua-table-count-limit-variants.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.map((effect) => effect.countLimitCode)).toEqual([17200 * 0x1000 + 0x10, 17200 * 0x1000 + 0x20]);
  });

  it("prunes mandatory Lua shared-count triggers after a sibling spends the count", () => {
    const fixture = setupLuaSharedCountTriggerFixture({
      seed: 95,
      codes: { summon: "15100", first: "15200", second: "15300" },
      triggerType: "EFFECT_TYPE_TRIGGER_F",
      countCode: "0x555",
      messages: ["first mandatory shared count trigger", "second mandatory shared count trigger"],
    });

    specialSummonDuelCard(fixture.session.state, fixture.summon.uid);
    expect(fixture.session.state.pendingTriggers).toHaveLength(2);
    const firstTrigger = getDuelLegalActions(fixture.session, 0).find((action) => action.type === "activateTrigger" && action.effectId === fixture.session.state.pendingTriggers[0]?.effectId);
    expect(firstTrigger).toBeDefined();
    applyAndAssert(fixture.session, firstTrigger!);

    expect(fixture.session.state.usedCountKeys).toEqual(["turn-1:0:code-1365"]);
    expect(fixture.session.state.pendingTriggers).toHaveLength(0);
    expect(getDuelLegalActions(fixture.session, 0).some((action) => action.type === "activateTrigger" || action.type === "declineTrigger")).toBe(false);
    expect(fixture.session.state.waitingFor).toBe(0);
    expect(fixture.host.messages).toContain(fixture.messages[0]);
    expect(fixture.host.messages).not.toContain(fixture.messages[1]);
  });
});
