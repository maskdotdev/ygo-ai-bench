import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

const cards: DuelCardData[] = [{ code: "100", name: "Random Probe", kind: "monster" }];

describe("Lua random helpers", () => {
  it("lets Lua scripts toss deterministic coins", () => {
    const first = setupSession(154);
    const second = setupSession(154);

    const firstMessages = tossCoinMessages(first);
    const secondMessages = tossCoinMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^coin one [01]$/);
    expect(firstMessages[1]).toMatch(/^coin three [01],[01],[01]$/);
    expect(first.state.randomCounter).toBe(4);
    expect(first.state.log.some((entry) => entry.action === "tossCoin" && entry.detail.includes(","))).toBe(true);
  });

  it("lets Lua scripts call deterministic coins", () => {
    const first = setupSession(155);
    const second = setupSession(155);

    const firstMessages = callCoinMessages(first);
    const secondMessages = callCoinMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^coin call true\/(true|false)$/);
    expect(firstMessages[1]).toBe("coin constants 1/0");
    expect(first.state.randomCounter).toBe(1);
    expect(first.state.lastCoinResults).toHaveLength(1);
    expect(first.state.log.some((entry) => entry.action === "callCoin" && entry.detail.includes("/"))).toBe(true);
  });

  it("lets Lua scripts count heads in coin results", () => {
    const session = setupSession(159);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local a,b,c=Duel.TossCoin(0,3)
      Debug.Message("count heads toss " .. Duel.CountHeads(a,b,c))
      Debug.Message("count heads constants " .. Duel.CountHeads(COIN_HEADS,COIN_TAILS,COIN_HEADS,7,nil))
      Debug.Message("count heads empty " .. Duel.CountHeads())
      Debug.Message("count tails toss " .. Duel.CountTails(a,b,c))
      Debug.Message("count tails constants " .. Duel.CountTails(COIN_HEADS,COIN_TAILS,COIN_TAILS,7,nil))
      Debug.Message("count tails empty " .. Duel.CountTails())
      `,
      "coin-count-heads.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages[0]).toMatch(/^count heads toss [0-3]$/);
    expect(host.messages).toContain("count heads constants 2");
    expect(host.messages).toContain("count heads empty 0");
    expect(host.messages).toContain(`count tails toss ${3 - Number(host.messages[0]?.at(-1) ?? 0)}`);
    expect(host.messages).toContain("count tails constants 2");
    expect(host.messages).toContain("count tails empty 0");
    expect(session.state.randomCounter).toBe(3);
  });

  it("lets Lua scripts decode random event payload counts", () => {
    const session = setupSession(160);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local coin_ev = 3 | (2 << 8) | (1 << 16)
      local dice_ev = 4 | (5 << 16)
      Debug.Message("coin ev " .. aux.GetCoinCountFromEv(coin_ev) .. "/" .. aux.GetCoinHeadsFromEv(coin_ev) .. "/" .. aux.GetCoinTailsFromEv(coin_ev))
      Debug.Message("dice ev " .. aux.GetDiceCountSelfFromEv(dice_ev) .. "/" .. aux.GetDiceCountOppoFromEv(dice_ev))
      Debug.Message("empty ev " .. aux.GetCoinCountFromEv(nil) .. "/" .. aux.GetDiceCountSelfFromEv(nil))
      `,
      "random-event-counts.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("coin ev 3/2/1");
    expect(host.messages).toContain("dice ev 4/5");
    expect(host.messages).toContain("empty ev 0/0");
  });

  it("lets Lua scripts override and read coin results", () => {
    const session = setupSession(161);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local empty={Duel.GetCoinResult()}
      local a,b=Duel.TossCoin(0,2)
      local tossed={Duel.GetCoinResult()}
      Duel.SetCoinResult(COIN_HEADS, COIN_TAILS, 7)
      local forced={Duel.GetCoinResult()}
      Debug.Message("coin result empty " .. #empty)
      Debug.Message("coin result tossed " .. a .. "," .. b .. "/" .. tossed[1] .. "," .. tossed[2])
      Debug.Message("coin result forced " .. forced[1] .. "," .. forced[2] .. "," .. forced[3])
      `,
      "coin-result.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("coin result empty 0");
    expect(host.messages[1]).toMatch(/^coin result tossed ([01]),([01])\/\1,\2$/);
    expect(host.messages).toContain("coin result forced 1,0,1");
    expect(session.state.lastCoinResults).toEqual([1, 0, 1]);
    expect(session.state.randomCounter).toBe(2);
  });

  it("preserves coin-call progression across snapshots", () => {
    const original = setupSession(156);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      Debug.Message("before snapshot " .. tostring(Duel.CallCoin(0)))
      `,
      "coin-call-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredCall = restoredHost.loadScript(
      `
      Debug.Message("after snapshot " .. tostring(Duel.CallCoin(0)))
      `,
      "coin-call-after-snapshot.lua",
    );
    expect(restoredCall.ok, restoredCall.error).toBe(true);

    const continuousHost = createLuaScriptHost(original);
    const continuousCall = continuousHost.loadScript(
      `
      Debug.Message("continuous " .. tostring(Duel.CallCoin(0)))
      `,
      "coin-call-continuous.lua",
    );
    expect(continuousCall.ok, continuousCall.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after snapshot", "continuous")).toBe(continuousHost.messages[0]);
  });

  it("lets Lua scripts toss deterministic dice", () => {
    const first = setupSession(152);
    const second = setupSession(152);

    const firstMessages = tossDiceMessages(first);
    const secondMessages = tossDiceMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^dice one [1-6]$/);
    expect(firstMessages[1]).toMatch(/^dice two [1-6],[1-6]$/);
    expect(first.state.randomCounter).toBe(3);
    expect(first.state.log.some((entry) => entry.action === "tossDice" && entry.detail.includes(","))).toBe(true);
  });

  it("lets Lua scripts read the last dice result", () => {
    const session = setupSession(167);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local empty={Duel.GetDiceResult()}
      local a=Duel.TossDice(0,1)
      local one={Duel.GetDiceResult()}
      local b,c=Duel.TossDice(1,2)
      local two={Duel.GetDiceResult()}
      Debug.Message("dice result empty " .. #empty)
      Debug.Message("dice result one " .. a .. "/" .. one[1])
      Debug.Message("dice result two " .. b .. "," .. c .. "/" .. two[1] .. "," .. two[2])
      `,
      "dice-result.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dice result empty 0");
    expect(host.messages[1]).toMatch(/^dice result one ([1-6])\/\1$/);
    expect(host.messages[2]).toMatch(/^dice result two ([1-6]),([1-6])\/\1,\2$/);
    expect(session.state.lastDiceResults).toHaveLength(2);
  });

  it("lets Lua scripts override dice results", () => {
    const session = setupSession(169);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Duel.SetDiceResult(2, 9, -1)
      local forced={Duel.GetDiceResult()}
      Debug.Message("dice result forced " .. a .. "/" .. forced[1] .. "," .. forced[2] .. "," .. forced[3])
      `,
      "dice-result-forced.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages[0]).toMatch(/^dice result forced [1-6]\/2,6,1$/);
    expect(session.state.lastDiceResults).toEqual([2, 6, 1]);
    expect(session.state.randomCounter).toBe(1);
  });

  it("preserves dice progression across snapshots", () => {
    const original = setupSession(153);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("before snapshot " .. a)
      `,
      "dice-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredRoll = restoredHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("after snapshot " .. a)
      `,
      "dice-after-snapshot.lua",
    );
    expect(restoredRoll.ok, restoredRoll.error).toBe(true);

    const continuousHost = createLuaScriptHost(original);
    const continuousRoll = continuousHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("continuous " .. a)
      `,
      "dice-continuous.lua",
    );
    expect(continuousRoll.ok, continuousRoll.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after snapshot", "continuous")).toBe(continuousHost.messages[0]);
  });

  it("preserves last dice results across snapshots", () => {
    const original = setupSession(168);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      local a,b=Duel.TossDice(0,2)
      Debug.Message("before dice result " .. a .. "," .. b)
      `,
      "dice-result-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredResult = restoredHost.loadScript(
      `
      local a,b=Duel.GetDiceResult()
      Debug.Message("after dice result " .. a .. "," .. b)
      `,
      "dice-result-after-snapshot.lua",
    );

    expect(restoredResult.ok, restoredResult.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after", "before")).toBe(firstHost.messages[0]);
  });

  it("preserves last coin results across snapshots", () => {
    const original = setupSession(162);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      Duel.SetCoinResult(COIN_TAILS, COIN_HEADS)
      Debug.Message("before coin result " .. table.concat({Duel.GetCoinResult()}, ","))
      `,
      "coin-result-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredResult = restoredHost.loadScript(
      `
      Debug.Message("after coin result " .. table.concat({Duel.GetCoinResult()}, ","))
      `,
      "coin-result-after-snapshot.lua",
    );

    expect(restoredResult.ok, restoredResult.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after", "before")).toBe(firstHost.messages[0]);
  });

  it("queues Lua toss triggers after coin and dice tosses", () => {
    const session = setupSession(170);
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local coin=Effect.CreateEffect(c)
          coin:SetType(EFFECT_TYPE_TRIGGER_O)
          coin:SetCode(EVENT_TOSS_COIN)
          coin:SetRange(LOCATION_HAND)
          coin:SetCondition(function(e,tp) return e:GetHandler():GetControler()==0 end)
          coin:SetOperation(function(e,tp,eg,ep,ev) Debug.Message("coin trigger resolved " .. ep .. "/" .. ev .. "/" .. table.concat({Duel.GetCoinResult()}, ",")) end)
          c:RegisterEffect(coin)

          local dice=Effect.CreateEffect(c)
          dice:SetType(EFFECT_TYPE_TRIGGER_O)
          dice:SetCode(EVENT_TOSS_DICE)
          dice:SetRange(LOCATION_HAND)
          dice:SetCondition(function(e,tp) return e:GetHandler():GetControler()==0 end)
          dice:SetOperation(function(e,tp,eg,ep,ev) Debug.Message("dice trigger resolved " .. ep .. "/" .. ev .. "/" .. table.concat({Duel.GetDiceResult()}, ",")) end)
          c:RegisterEffect(dice)
        end
        `;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const result = host.loadScript(
      `
      local a,b=Duel.TossCoin(0,2)
      Debug.Message("coin tossed " .. a .. "," .. b)
      `,
      "random-toss-triggers.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages[0]).toMatch(/^coin tossed [01],[01]$/);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["coinTossed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1151, eventPlayer: 0, eventValue: 2 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "coinTossed", eventCode: 1151, eventPlayer: 0, eventValue: 2 });
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1151, eventPlayer: 0, eventValue: 2 });
    const restoredCoinTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredCoinTrigger).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredCoinTrigger!).ok).toBe(true);
    expect(restored.host.messages[0]).toMatch(/^coin trigger resolved 0\/2\/[01],[01]$/);
    const coinTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(coinTrigger).toBeDefined();
    expect(applyResponse(session, coinTrigger!).ok).toBe(true);
    expect(host.messages[1]).toMatch(/^coin trigger resolved 0\/2\/[01],[01]$/);

    const diceResult = host.loadScript(
      `
      local a,b=Duel.TossDice(0,2)
      Debug.Message("dice tossed " .. a .. "," .. b)
      `,
      "random-toss-dice-trigger.lua",
    );
    expect(diceResult.ok, diceResult.error).toBe(true);
    expect(host.messages[2]).toMatch(/^dice tossed [1-6],[1-6]$/);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["diceTossed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1150, eventPlayer: 0, eventValue: 2 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "diceTossed", eventCode: 1150, eventPlayer: 0, eventValue: 2 });
    const diceTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(diceTrigger).toBeDefined();
    expect(applyResponse(session, diceTrigger!).ok).toBe(true);
    expect(host.messages[3]).toMatch(/^dice trigger resolved 0\/2\/[1-6],[1-6]$/);
  });

  it("queues Lua coin toss triggers after called coins", () => {
    const session = setupSession(171);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local coin=Effect.CreateEffect(watcher)
      coin:SetType(EFFECT_TYPE_TRIGGER_O)
      coin:SetCode(EVENT_TOSS_COIN)
      coin:SetRange(LOCATION_HAND)
      coin:SetOperation(function(e,tp,eg,ep,ev) Debug.Message("called coin trigger resolved " .. ep .. "/" .. ev .. "/" .. table.concat({Duel.GetCoinResult()}, ",")) end)
      watcher:RegisterEffect(coin)

      Debug.Message("coin called " .. tostring(Duel.CallCoin(0)))
      `,
      "random-call-coin-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages[0]).toMatch(/^coin called (true|false)$/);
    expect(session.state.lastCoinResults).toHaveLength(1);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["coinTossed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1151, eventPlayer: 0, eventValue: 1 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "coinTossed", eventCode: 1151, eventPlayer: 0, eventValue: 1 });
    const coinTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(coinTrigger).toBeDefined();
    expect(applyResponse(session, coinTrigger!).ok).toBe(true);
    expect(host.messages[1]).toMatch(/^called coin trigger resolved 0\/1\/[01]$/);
  });

  it("maps raised Lua toss-negate event codes to matching triggers", () => {
    const session = setupSession(172);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local coin=Effect.CreateEffect(watcher)
      coin:SetType(EFFECT_TYPE_TRIGGER_O)
      coin:SetCode(EVENT_TOSS_COIN_NEGATE)
      coin:SetRange(LOCATION_HAND)
      coin:SetOperation(function(e,tp,eg) Debug.Message("coin negate trigger " .. eg:GetFirst():GetCode()) end)
      watcher:RegisterEffect(coin)

      local dice=Effect.CreateEffect(watcher)
      dice:SetType(EFFECT_TYPE_TRIGGER_O)
      dice:SetCode(EVENT_TOSS_DICE_NEGATE)
      dice:SetRange(LOCATION_HAND)
      dice:SetOperation(function(e,tp,eg) Debug.Message("dice negate trigger " .. eg:GetFirst():GetCode()) end)
      watcher:RegisterEffect(dice)

      Duel.RaiseEvent(watcher, EVENT_TOSS_COIN_NEGATE, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("coin negate check " .. tostring(Duel.CheckEvent(EVENT_TOSS_COIN_NEGATE)) .. "/" .. tostring(Duel.CheckEvent(EVENT_TOSS_DICE_NEGATE)))
      `,
      "random-toss-negate-events.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("coin negate check true/false");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["coinTossNegated"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1152 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "coinTossNegated", eventCode: 1152 });
    const coinTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(coinTrigger).toBeDefined();
    expect(applyResponse(session, coinTrigger!).ok).toBe(true);
    expect(host.messages).toContain("coin negate trigger 100");

    const diceResult = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(watcher, EVENT_TOSS_DICE_NEGATE, nil, REASON_EFFECT, 0, 0, 0)
      `,
      "random-dice-negate-event.lua",
    );
    expect(diceResult.ok, diceResult.error).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["diceTossNegated"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1153 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "diceTossNegated", eventCode: 1153 });
    const diceTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(diceTrigger).toBeDefined();
    expect(applyResponse(session, diceTrigger!).ok).toBe(true);
    expect(host.messages).toContain("dice negate trigger 100");
  });

  it("lets Lua scripts get deterministic random numbers", () => {
    const first = setupSession(157);
    const second = setupSession(157);

    const firstMessages = randomNumberMessages(first);
    const secondMessages = randomNumberMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^random range [1-6],[1-6]$/);
    expect(firstMessages[1]).toMatch(/^random reversed [1-6]$/);
    expect(first.state.randomCounter).toBe(3);
  });

  it("lets Lua scripts resolve deterministic rock paper scissors", () => {
    const first = setupSession(160);
    const second = setupSession(160);

    const firstMessages = rockPaperScissorsMessages(first);
    const secondMessages = rockPaperScissorsMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^rps [01]\/[01]$/);
    expect(first.state.randomCounter).toBe(2);
    expect(first.state.log.some((entry) => entry.action === "rockPaperScissors" && /^[01]$/.test(String(entry.player)))).toBe(true);
  });

  it("preserves random-number progression across snapshots", () => {
    const original = setupSession(158);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      Debug.Message("before snapshot " .. Duel.GetRandomNumber(1,6))
      `,
      "random-number-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredRoll = restoredHost.loadScript(
      `
      Debug.Message("after snapshot " .. Duel.GetRandomNumber(1,6))
      `,
      "random-number-after-snapshot.lua",
    );
    expect(restoredRoll.ok, restoredRoll.error).toBe(true);

    const continuousHost = createLuaScriptHost(original);
    const continuousRoll = continuousHost.loadScript(
      `
      Debug.Message("continuous " .. Duel.GetRandomNumber(1,6))
      `,
      "random-number-continuous.lua",
    );
    expect(continuousRoll.ok, continuousRoll.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after snapshot", "continuous")).toBe(continuousHost.messages[0]);
  });
});

function setupSession(seed: number): DuelSession {
  const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["100"] },
  });
  startDuel(session);
  return session;
}

function tossDiceMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local a=Duel.TossDice(0,1)
    local b,c=Duel.TossDice(1,2)
    Debug.Message("dice one " .. a)
    Debug.Message("dice two " .. b .. "," .. c)
    `,
    "dice-toss.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}

function tossCoinMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local a=Duel.TossCoin(0,1)
    local b,c,d=Duel.TossCoin(1,3)
    Debug.Message("coin one " .. a)
    Debug.Message("coin three " .. b .. "," .. c .. "," .. d)
    `,
    "coin-toss.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}

function callCoinMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local announced=Duel.AnnounceCoin(0)
    local called=Duel.CallCoin(0)
    Debug.Message("coin call " .. tostring(announced == COIN_HEADS) .. "/" .. tostring(called))
    Debug.Message("coin constants " .. COIN_HEADS .. "/" .. COIN_TAILS)
    `,
    "coin-call.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}

function randomNumberMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local a=Duel.GetRandomNumber(1,6)
    local b=Duel.GetRandomNumber(1,6)
    local c=Duel.GetRandomNumber(6,1)
    Debug.Message("random range " .. a .. "," .. b)
    Debug.Message("random reversed " .. c)
    `,
    "random-number.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}

function rockPaperScissorsMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local a=Duel.RockPaperScissors()
    local b=Duel.RockPaperScissors(false)
    Debug.Message("rps " .. a .. "/" .. b)
    `,
    "rock-paper-scissors.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}
