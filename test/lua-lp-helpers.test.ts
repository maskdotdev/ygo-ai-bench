import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
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

  it("keeps LP helpers from mutating ended duels", () => {
    const session = createDuel({ seed: 952, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("damage " .. Duel.Damage(1, 500, REASON_EFFECT))
      Debug.Message("recover " .. Duel.Recover(0, 500, REASON_EFFECT))
      Duel.SetLP(1, 1234)
      Duel.PayLPCost(0, 500)
      `,
      "ended-lp-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["damage 0", "recover 0"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.log.filter((entry) => entry.action === "win")).toHaveLength(1);
  });

  it("keeps Duel.Win from replacing an ended duel result", () => {
    const session = createDuel({ seed: 953, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.Win(1, WIN_REASON_DEUCE)
      `,
      "ended-win-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.winReason).toBe(0x10);
    expect(session.state.log.filter((entry) => entry.action === "win")).toHaveLength(1);
  });

  it("keeps Duel.Draw from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Post-End Draw", kind: "monster" }];
    const session = createDuel({ seed: 954, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("draw " .. Duel.Draw(0, 1, REASON_EFFECT))
      `,
      "ended-draw-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["draw 0"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.cards.find((card) => card.code === "100")?.location).toBe("deck");
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("keeps deck discard helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post-End Hand", kind: "monster" },
      { code: "200", name: "Post-End Deck", kind: "monster" },
    ];
    const session = createDuel({ seed: 955, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const handCard = session.state.cards.find((card) => card.location === "hand");
    const deckCard = session.state.cards.find((card) => card.location === "deck");
    expect(handCard).toBeDefined();
    expect(deckCard).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("discard deck " .. Duel.DiscardDeck(0, 1, REASON_EFFECT))
      Debug.Message("discard hand " .. Duel.DiscardHand(0, aux.TRUE, 1, 1, REASON_EFFECT))
      Debug.Message("operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-discard-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["discard deck 0", "discard hand 0", "operated 0"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.cards.find((card) => card.uid === handCard!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === deckCard!.uid)?.location).toBe("deck");
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("makes earlier Lua optional when triggers miss timing at damage boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Damage Boundary Source", kind: "monster" },
      { code: "200", name: "Damage Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 958, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.Damage(1, 500, REASON_EFFECT)
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

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "damage-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.players[1].lifePoints).toBe(7500);
  });

  it("makes Lua optional when damage triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Damage Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Damage Watcher", kind: "monster" },
      { code: "400", name: "If Damage Watcher", kind: "monster" },
      { code: "500", name: "Dice Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 959, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local dice_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.Damage(1, 500, REASON_EFFECT)
        Duel.TossDice(0, 1)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_DAMAGE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when damage resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_DAMAGE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if damage resolved")
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
      "damage-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1111");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1111", "lua-4-1150"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 }), expect.objectContaining({ eventName: "diceTossed", eventCode: 1150 })]),
    );
  });

  it("keeps deck and grave swap from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post-End Deck", kind: "monster" },
      { code: "200", name: "Post-End Grave", kind: "monster" },
    ];
    const session = createDuel({ seed: 956, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const graveCard = session.state.cards.find((card) => card.code === "200");
    expect(graveCard).toBeDefined();
    moveDuelCard(session.state, graveCard!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.SwapDeckAndGrave(0)
      Debug.Message("operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-swap-deck-grave-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["operated 0"]);
    expect(session.state.cards.find((card) => card.code === "100")?.location).toBe("deck");
    expect(session.state.cards.find((card) => card.code === "200")?.location).toBe("graveyard");
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("keeps deck shuffle and sort helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post-End First", kind: "monster" },
      { code: "200", name: "Post-End Second", kind: "monster" },
      { code: "300", name: "Post-End Third", kind: "monster" },
    ];
    const session = createDuel({ seed: 957, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const beforeOrder = session.state.cards
      .filter((card) => card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.SortDeckbottom(0, 0, 2)
      Debug.Message("sort operated " .. Duel.GetOperatedGroup():GetCount())
      Duel.ShuffleDeck(0)
      Duel.DisableShuffleCheck()
      `,
      "ended-sort-shuffle-noop.lua",
    );

    const afterOrder = session.state.cards
      .filter((card) => card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .map((card) => card.code);
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["sort operated 0"]);
    expect(afterOrder).toEqual(beforeOrder);
    expect(session.state.shuffleCheckDisabled).toBe(false);
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("keeps deck top and bottom movement helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post-End Move A", kind: "monster" },
      { code: "200", name: "Post-End Move B", kind: "monster" },
      { code: "300", name: "Post-End Move C", kind: "monster" },
    ];
    const session = createDuel({ seed: 958, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const beforeOrder = session.state.cards
      .filter((card) => card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("top " .. Duel.MoveToDeckTop(2, 0))
      Debug.Message("bottom " .. Duel.MoveToDeckBottom(1, 0))
      Debug.Message("operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-deck-top-bottom-noop.lua",
    );

    const afterOrder = session.state.cards
      .filter((card) => card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .map((card) => card.code);
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["top 0", "bottom 0", "operated 0"]);
    expect(afterOrder).toEqual(beforeOrder);
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("keeps generic movement helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post-End Grave Target", kind: "monster" },
      { code: "200", name: "Post-End Hand Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 959, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const handCard = session.state.cards.find((card) => card.location === "hand");
    const deckCard = session.state.cards.find((card) => card.location === "deck");
    expect(handCard).toBeDefined();
    expect(deckCard).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local hand_card=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil)
      local deck_card=Duel.GetDecktopGroup(0, 1)
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("grave " .. Duel.SendtoGrave(hand_card, REASON_EFFECT))
      Debug.Message("hand " .. Duel.SendtoHand(deck_card, 0, REASON_EFFECT))
      Debug.Message("operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-generic-move-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["grave 0", "hand 0", "operated 0"]);
    expect(session.state.cards.find((card) => card.uid === handCard!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === deckCard!.uid)?.location).toBe("deck");
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("clears pending actors when LP loss ends the duel", () => {
    const session = createDuel({ seed: 951, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);
    session.state.prompt = { id: "stale-prompt", player: 0, type: "selectYesNo", description: 1, returnTo: 0 };
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("damage " .. Duel.Damage(0, 8000, REASON_EFFECT))
      `,
      "lp-loss-cleanup.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("damage 8000");
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(1);
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBeUndefined();
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

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local burn=Effect.CreateEffect(c)
            burn:SetType(EFFECT_TYPE_IGNITION)
            burn:SetRange(LOCATION_HAND)
            burn:SetOperation(function(e,tp)
              Debug.Message("burn applied " .. Duel.Damage(1, 700, REASON_EFFECT))
            end)
            c:RegisterEffect(burn)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local trigger=Effect.CreateEffect(c)
            trigger:SetType(EFFECT_TYPE_TRIGGER_O)
            trigger:SetCode(EVENT_DAMAGE)
            trigger:SetRange(LOCATION_HAND)
            trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("damage trigger resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. Duel.GetLP(1))
              Debug.Message("damage reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(trigger)
          end
          `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const result = host.loadCardScript(100, source);
    const watcherResult = host.loadCardScript(200, source);

    expect(result.ok, result.error).toBe(true);
    expect(watcherResult.ok, watcherResult.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const burn = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(burn).toBeDefined();
    applyAndAssert(session, burn!);
    expect(host.messages).toContain("burn applied 700");
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageDealt"]);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1111, eventPlayer: 1, eventValue: 700, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "damageDealt", eventCode: 1111, eventPlayer: 1, eventValue: 700, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1111, eventPlayer: 1, eventValue: 700, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, restoredTrigger!);
    expect(restored.host.messages).toContain("damage trigger resolved 1/700/64/0/7300");
    expect(restored.host.messages).toContain("damage reason effect true");

    const damageTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(damageTrigger).toBeDefined();
    applyAndAssert(session, damageTrigger!);
    expect(host.messages).toContain("damage trigger resolved 1/700/64/0/7300");
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
      trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("recover trigger resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. Duel.GetLP(0))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-recover-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const recover = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(recover).toBeDefined();
    applyAndAssert(session, recover!);
    expect(host.messages).toContain("recover applied 900");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["recoveredLifePoints"]);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1112, eventPlayer: 0, eventValue: 900, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112, eventPlayer: 0, eventValue: 900, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 })]));

    const recoverTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(recoverTrigger).toBeDefined();
    applyAndAssert(session, recoverTrigger!);
    expect(host.messages).toContain("recover trigger resolved 0/900/64/0/7400");
  });

  it("makes Lua optional when recover triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recover Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Recover Watcher", kind: "monster" },
      { code: "400", name: "If Recover Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 960, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);
    session.state.players[0].lifePoints = 6500;

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
        Duel.Recover(0, 900, REASON_EFFECT)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_RECOVER)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when recover resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_RECOVER)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if recover resolved")
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
      "recover-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1112");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1112", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
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
      trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("cost trigger resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. Duel.GetLP(0))
      end)
      watcher:RegisterEffect(trigger)
      `,
      "lua-lp-cost-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const pay = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(pay).toBeDefined();
    applyAndAssert(session, pay!);
    expect(host.messages).toContain("cost paid 7400");
    expect(session.state.players[0].lifePoints).toBe(7400);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["lifePointCostPaid"]);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1201, eventPlayer: 0, eventValue: 600, eventReason: 0x80, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 0, eventValue: 600, eventReason: 0x80, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 })]));

    const costTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(costTrigger).toBeDefined();
    applyAndAssert(session, costTrigger!);
    expect(host.messages).toContain("cost trigger resolved 0/600/128/0/7400");
  });

  it("makes Lua optional when LP-cost triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Cost Watcher", kind: "monster" },
      { code: "400", name: "If Cost Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 961, startingHandSize: 4, cardReader: createCardReader(cards) });
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
        Duel.PayLPCost(0, 600)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_PAY_LPCOST)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when cost resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_PAY_LPCOST)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if cost resolved")
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
      "lp-cost-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1201");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1201", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
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

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local draw=Effect.CreateEffect(c)
            draw:SetType(EFFECT_TYPE_IGNITION)
            draw:SetRange(LOCATION_HAND)
            draw:SetOperation(function(e,tp)
              Debug.Message("draw applied " .. Duel.Draw(0, 1, REASON_EFFECT))
            end)
            c:RegisterEffect(draw)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local trigger=Effect.CreateEffect(c)
            trigger:SetType(EFFECT_TYPE_TRIGGER_O)
            trigger:SetCode(EVENT_DRAW)
            trigger:SetRange(LOCATION_HAND)
            trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("draw trigger resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_HAND, 0))
              Debug.Message("draw reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(trigger)
          end
          `;
        }
        return undefined;
      },
    };

    const host = createLuaScriptHost(session);
    const starterLoaded = host.loadCardScript(100, source);
    const watcherLoaded = host.loadCardScript(200, source);

    expect(starterLoaded.ok, starterLoaded.error).toBe(true);
    expect(watcherLoaded.ok, watcherLoaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const draw = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(draw).toBeDefined();
    applyAndAssert(session, draw!);
    expect(host.messages).toContain("draw applied 1");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("hand");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["cardsDrawn"]);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventValue: 1, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    const drawnUid = session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.uid;
    expect(drawnUid).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventUids: [drawnUid] });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventValue: 1, eventUids: [drawnUid], eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventValue: 1, eventUids: [drawnUid], eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, restoredTrigger!);
    expect(restored.host.messages).toContain("draw trigger resolved 0/1/64/0/1/3");
    expect(restored.host.messages).toContain("draw reason effect true");

    const drawTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(drawTrigger).toBeDefined();
    applyAndAssert(session, drawTrigger!);
    expect(host.messages).toContain("draw trigger resolved 0/1/64/0/1/3");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  assertPublicRestoreMetadata(restored, response);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
