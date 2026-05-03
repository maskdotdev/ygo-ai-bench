import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua LP helpers", () => {
  it("lets Lua scripts end the duel with a win reason", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Win Condition", kind: "monster" }];
    const session = createDuel({ seed: 94, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("winner set")
      `,
      "win.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("winner set");
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.winReason).toBe(0x10);
    expect(session.state.waitingFor).toBeUndefined();
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "win", player: 0, detail: "16" }));
    expect(queryPublicState(session)).toMatchObject({ status: "ended", winner: 0, winReason: 0x10 });
  });

  it("lets Lua scripts declare a draw result", () => {
    const session = createDuel({ seed: 95, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(PLAYER_NONE, WIN_REASON_DEUCE)
      `,
      "draw-win.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe("draw");
    expect(session.state.winReason).toBe(0x54);
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "win", detail: "84" }));
  });

  it("exposes EDOPro player constants to Lua scripts", () => {
    const session = createDuel({ seed: 950, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("player constants " .. PLAYER_NONE .. "/" .. PLAYER_ALL)
      `,
      "player-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player constants 2/3");
  });

  it("queues Lua damage triggers after Duel.Damage applies damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Burn Starter", kind: "monster" },
      { code: "200", name: "Damage Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local burn=Effect.CreateEffect(starter)
      burn:SetType(EFFECT_TYPE_IGNITION)
      burn:SetRange(LOCATION_HAND)
      burn:SetOperation(function(e,tp)
        Debug.Message("burn applied " .. Duel.Damage(1, 700, REASON_EFFECT))
      end)
      starter:RegisterEffect(burn)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_DAMAGE)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp)
        Debug.Message("damage trigger resolved " .. Duel.GetLP(1))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-damage-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const burn = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(burn).toBeDefined();
    expect(applyResponse(session, burn!).ok).toBe(true);
    expect(host.messages).toContain("burn applied 700");
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageDealt"]);

    const damageTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(damageTrigger).toBeDefined();
    expect(applyResponse(session, damageTrigger!).ok).toBe(true);
    expect(host.messages).toContain("damage trigger resolved 7300");
  });

  it("queues Lua recover triggers after Duel.Recover applies recovery", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recover Starter", kind: "monster" },
      { code: "200", name: "Recover Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    session.state.players[0].lifePoints = 6500;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local heal=Effect.CreateEffect(starter)
      heal:SetType(EFFECT_TYPE_IGNITION)
      heal:SetRange(LOCATION_HAND)
      heal:SetOperation(function(e,tp)
        Debug.Message("recover applied " .. Duel.Recover(0, 900, REASON_EFFECT))
      end)
      starter:RegisterEffect(heal)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_RECOVER)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp)
        Debug.Message("recover trigger resolved " .. Duel.GetLP(0))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-recover-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const recover = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(recover).toBeDefined();
    expect(applyResponse(session, recover!).ok).toBe(true);
    expect(host.messages).toContain("recover applied 900");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["recoveredLifePoints"]);

    const recoverTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(recoverTrigger).toBeDefined();
    expect(applyResponse(session, recoverTrigger!).ok).toBe(true);
    expect(host.messages).toContain("recover trigger resolved 7400");
  });

  it("queues Lua LP-cost triggers after Duel.PayLPCost pays a cost", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Starter", kind: "monster" },
      { code: "200", name: "Cost Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 99, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local pay=Effect.CreateEffect(starter)
      pay:SetType(EFFECT_TYPE_IGNITION)
      pay:SetRange(LOCATION_HAND)
      pay:SetOperation(function(e,tp)
        Duel.PayLPCost(0, 600)
        Debug.Message("cost paid " .. Duel.GetLP(0))
      end)
      starter:RegisterEffect(pay)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_PAY_LPCOST)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp)
        Debug.Message("cost trigger resolved " .. Duel.GetLP(0))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-lp-cost-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const pay = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(pay).toBeDefined();
    expect(applyResponse(session, pay!).ok).toBe(true);
    expect(host.messages).toContain("cost paid 7400");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["lifePointCostPaid"]);

    const costTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(costTrigger).toBeDefined();
    expect(applyResponse(session, costTrigger!).ok).toBe(true);
    expect(host.messages).toContain("cost trigger resolved 7400");
  });

  it("queues Lua draw triggers after Duel.Draw draws cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw Starter", kind: "monster" },
      { code: "200", name: "Draw Watcher", kind: "monster" },
      { code: "300", name: "Drawn Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local draw=Effect.CreateEffect(starter)
      draw:SetType(EFFECT_TYPE_IGNITION)
      draw:SetRange(LOCATION_HAND)
      draw:SetOperation(function(e,tp)
        Debug.Message("draw applied " .. Duel.Draw(0, 1, REASON_EFFECT))
      end)
      starter:RegisterEffect(draw)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_DRAW)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp)
        Debug.Message("draw trigger resolved " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_HAND, 0))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-draw-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const draw = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(draw).toBeDefined();
    expect(applyResponse(session, draw!).ok).toBe(true);
    expect(host.messages).toContain("draw applied 1");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("hand");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["cardsDrawn"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "cardsDrawn", eventCode: 1110 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110 })]));

    const drawTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(drawTrigger).toBeDefined();
    expect(applyResponse(session, drawTrigger!).ok).toBe(true);
    expect(host.messages).toContain("draw trigger resolved 1/3");
  });
});
