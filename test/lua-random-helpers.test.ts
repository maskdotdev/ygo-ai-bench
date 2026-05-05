import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
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

  it("keeps random helpers from mutating ended duels", () => {
    const session = setupSession(168);
    session.state.lastCoinResults = [1, 0];
    session.state.lastDiceResults = [2, 5];
    session.state.randomCounter = 4;
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0,WIN_REASON_EXODIA)
      Debug.Message("coin returns " .. select("#", Duel.TossCoin(0,2)))
      Debug.Message("dice returns " .. select("#", Duel.TossDice(0,2)))
      Debug.Message("call ended " .. tostring(Duel.CallCoin(0)))
      Duel.SetCoinResult(0,0,0)
      Duel.SetDiceResult(6,6,6)
      Debug.Message("coin result " .. table.concat({Duel.GetCoinResult()}, ","))
      Debug.Message("dice result " .. table.concat({Duel.GetDiceResult()}, ","))
      Debug.Message("random ended " .. Duel.GetRandomNumber(1,6))
      Debug.Message("rps ended " .. Duel.RockPaperScissors())
      `,
      "ended-random-noop.lua",
    );
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toEqual([
      "coin returns 0",
      "dice returns 0",
      "call ended false",
      "coin result 1,0",
      "dice result 2,5",
      "random ended 0",
      "rps ended 0",
    ]);
    expect(session.state.status).toBe("ended");
    expect(session.state.randomCounter).toBe(4);
    expect(session.state.lastCoinResults).toEqual([1, 0]);
    expect(session.state.lastDiceResults).toEqual([2, 5]);
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.eventHistory.map((event) => event.eventName)).not.toContain("coinTossed");
    expect(session.state.eventHistory.map((event) => event.eventName)).not.toContain("diceTossed");
    expect(session.state.log.map((entry) => entry.action)).not.toContain("tossCoin");
    expect(session.state.log.map((entry) => entry.action)).not.toContain("tossDice");
    expect(session.state.log.map((entry) => entry.action)).not.toContain("callCoin");
    expect(session.state.log.map((entry) => entry.action)).not.toContain("rockPaperScissors");
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
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    const restoredCoinTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredCoinTrigger).toBeDefined();
    const restoredCoinResult = applyLuaRestoreResponse(restored, restoredCoinTrigger!);
    expect(restoredCoinResult.ok).toBe(true);
    expect(restoredCoinResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, restoredCoinResult.state.waitingFor!));
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
    const restoredDice = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restoredDice.restoreComplete).toBe(true);
    expect(restoredDice.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1150, eventPlayer: 0, eventValue: 2 });
    expect(getLuaRestoreLegalActionGroups(restoredDice, 0)).toEqual(getGroupedDuelLegalActions(restoredDice.session, 0));
    const restoredDiceTrigger = getLuaRestoreLegalActions(restoredDice, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredDiceTrigger).toBeDefined();
    const restoredDiceResult = applyLuaRestoreResponse(restoredDice, restoredDiceTrigger!);
    expect(restoredDiceResult.ok).toBe(true);
    expect(restoredDiceResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredDice.session, restoredDiceResult.state.waitingFor!));
    expect(restoredDice.host.messages[0]).toMatch(/^dice trigger resolved 0\/2\/[1-6],[1-6]$/);
    const diceTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(diceTrigger).toBeDefined();
    expect(applyResponse(session, diceTrigger!).ok).toBe(true);
    expect(host.messages[3]).toMatch(/^dice trigger resolved 0\/2\/[1-6],[1-6]$/);
  });

  it("makes earlier Lua optional when triggers miss timing at dice toss boundaries", () => {
    const randomCards: DuelCardData[] = [
      { code: "100", name: "Dice Boundary Source", kind: "monster" },
      { code: "200", name: "Dice Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Dice Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 171, startingHandSize: 5, cardReader: createCardReader(randomCards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local dice_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.TossDice(0, 1)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to grave resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to grave resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local dice_effect=Effect.CreateEffect(dice_watcher)
      dice_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      dice_effect:SetCode(EVENT_TOSS_DICE)
      dice_effect:SetRange(LOCATION_HAND)
      dice_effect:SetOperation(function(e,tp)
        Debug.Message("dice boundary resolved")
      end)
      dice_watcher:RegisterEffect(dice_effect)
      `,
      "dice-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1150"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "diceTossed", eventCode: 1150 })]),
    );
    expect(session.state.lastDiceResults).toHaveLength(1);
  });

  it("makes Lua optional when dice triggers miss timing after later event boundaries", () => {
    const randomCards: DuelCardData[] = [
      { code: "100", name: "Dice Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Dice Watcher", kind: "monster" },
      { code: "400", name: "If Dice Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 172, startingHandSize: 4, cardReader: createCardReader(randomCards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.TossDice(0, 1)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TOSS_DICE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when dice resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TOSS_DICE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if dice resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "dice-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1150");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1150", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "diceTossed", eventCode: 1150 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("makes Lua optional when coin triggers miss timing after later event boundaries", () => {
    const randomCards: DuelCardData[] = [
      { code: "100", name: "Coin Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Coin Watcher", kind: "monster" },
      { code: "400", name: "If Coin Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 173, startingHandSize: 4, cardReader: createCardReader(randomCards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.TossCoin(0, 1)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TOSS_COIN)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when coin resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TOSS_COIN)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if coin resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "coin-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1151");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1151", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "coinTossed", eventCode: 1151 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
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
