import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua control and return movement helpers", () => {
  it("lets Lua scripts hide Spell/Trap cards as face-down monster-zone decoys", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Decoy Spell A", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Decoy Trap B", kind: "trap", typeFlags: 0x4 },
    ];
    const session = createDuel({ seed: 41, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local g=Duel.GetMatchingGroup(aux.TRUE,0,LOCATION_HAND,0,nil)
      local hidden=Group.CreateGroup()
      for tc in aux.Next(g) do
        if Duel.MoveToField(tc,0,0,LOCATION_MZONE,POS_FACEDOWN_DEFENSE,true)>0 then
          hidden:AddCard(tc)
        end
      end
      Duel.ShuffleSetCard(hidden)
      local first=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local second=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      Debug.Message("hidden decoys " .. Duel.GetOperatedGroup():GetCount() .. "/" .. first:GetLocation() .. "/" .. tostring(first:IsFacedown()) .. "/" .. tostring(first:IsSpellTrapCard()))
      Debug.Message("hidden second " .. second:GetLocation() .. "/" .. tostring(second:IsFacedown()) .. "/" .. tostring(second:IsSpellTrapCard()))
      `,
      "spell-trap-monster-decoys.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hidden decoys 2/4/true/true");
    expect(host.messages).toContain("hidden second 4/true/true");
    expect(session.state.cards.filter((card) => card.location === "monsterZone" && !card.faceUp).map((card) => card.code).sort()).toEqual(["100", "200"]);
  });

  it("lets Lua scripts move cards to hand, deck, and extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recoverable Monster", kind: "monster" },
      { code: "300", name: "Illegal Extra Return", kind: "monster" },
      { code: "301", name: "Pendulum Extra Return", kind: "monster", typeFlags: 0x1000001 },
      { code: "900", name: "Extra Return", kind: "extra" },
      { code: "901", name: "Extra Alias Return", kind: "extra" },
      { code: "902", name: "Generic Extra Return", kind: "extra" },
    ];
    const session = createDuel({ seed: 9, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "301"], extra: ["900", "901", "902"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && (candidate.code === "100" || candidate.code === "300" || candidate.code === "301" || candidate.code === "900" || candidate.code === "901" || candidate.code === "902"))) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local recover = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to hand " .. Duel.SendtoHand(recover, 0, REASON_EFFECT))
      Debug.Message("operated hand " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("to deck " .. Duel.SendtoDeck(hand, 0, 0, REASON_EFFECT))
      Debug.Message("operated deck " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra " .. Duel.SendtoExtraP(extra, 0, REASON_EFFECT))
      Debug.Message("operated extra " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local extra_alias = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra alias " .. Duel.SendtoExtra(extra_alias, 0, REASON_EFFECT))
      Debug.Message("operated extra alias " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local generic_extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 902), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("generic to extra " .. Duel.Sendto(generic_extra, LOCATION_EXTRA, REASON_EFFECT, POS_FACEDOWN_DEFENSE))
      Debug.Message("operated generic extra " .. Duel.GetOperatedGroup():GetFirst():GetCode() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetLocation() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetPosition())
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("pendulum able extra " .. tostring(pendulum:GetFirst():IsAbleToExtra()))
      Debug.Message("to pendulum extra " .. Duel.SendtoExtraP(pendulum, 0, REASON_EFFECT))
      Debug.Message("pendulum extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local illegal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("illegal extra " .. Duel.SendtoExtraP(illegal, 0, REASON_EFFECT))
      Debug.Message("operated illegal " .. Duel.GetOperatedGroup():GetCount())
      `,
      "movement-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("to hand 1");
    expect(host.messages).toContain("operated hand 100");
    expect(host.messages).toContain("to deck 1");
    expect(host.messages).toContain("operated deck 100");
    expect(host.messages).toContain("to extra 1");
    expect(host.messages).toContain("operated extra 900");
    expect(host.messages).toContain("extra faceup false");
    expect(host.messages).toContain("to extra alias 1");
    expect(host.messages).toContain("operated extra alias 901");
    expect(host.messages).toContain("generic to extra 1");
    expect(host.messages).toContain("operated generic extra 902/64/8");
    expect(host.messages).toContain("pendulum able extra true");
    expect(host.messages).toContain("to pendulum extra 1");
    expect(host.messages).toContain("pendulum extra faceup true");
    expect(host.messages).toContain("illegal extra 0");
    expect(host.messages).toContain("operated illegal 0");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "100")?.location).toBe("deck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "900")?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "902")).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDownDefense" });
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "301")).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("graveyard");
  });

  it("honors EDOPro SendtoDeck sequence arguments", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Top Return", kind: "monster" },
      { code: "200", name: "Bottom Return", kind: "monster" },
      { code: "900", name: "Deck Anchor A", kind: "monster" },
      { code: "901", name: "Deck Anchor B", kind: "monster" },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900", "901", "100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const topReturn = session.state.cards.find((card) => card.code === "100");
    const bottomReturn = session.state.cards.find((card) => card.code === "200");
    expect(topReturn).toBeDefined();
    expect(bottomReturn).toBeDefined();
    moveDuelCard(session.state, topReturn!.uid, "graveyard", 0);
    moveDuelCard(session.state, bottomReturn!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      local bottom = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("deck seq constants " .. SEQ_DECKTOP .. "/" .. SEQ_DECKBOTTOM .. "/" .. SEQ_DECKSHUFFLE)
      Debug.Message("deck seq moved " .. Duel.SendtoDeck(top, nil, SEQ_DECKTOP, REASON_EFFECT) .. "/" .. Duel.SendtoDeck(bottom, nil, SEQ_DECKBOTTOM, REASON_EFFECT))
      `,
      "sendto-deck-sequence.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("deck seq constants 0/1/2");
    expect(host.messages).toContain("deck seq moved 1/1");
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual(["100", "900", "901", "200"]);
  });

  it("queues Lua to-hand triggers after cards move to hand", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Hand Starter", kind: "monster" },
      { code: "200", name: "To Hand Target", kind: "monster" },
      { code: "300", name: "To Hand Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 176, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Debug.Message("to hand event count " .. Duel.SendtoHand(target, 1, REASON_EFFECT))
      end)
      starter:RegisterEffect(move)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_TO_HAND)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("to hand trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "to-hand-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("to hand event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand", controller: 1 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHand"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1012, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("to hand trigger resolved 200");
  });

  it("applies restored Lua to-hand triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore To Hand Starter", kind: "monster" },
      { code: "200", name: "Restore To Hand Target", kind: "monster" },
      { code: "300", name: "Restore To Hand Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
              Duel.SendtoHand(target, 1, REASON_EFFECT)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_TO_HAND)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored to hand trigger " .. eg:GetFirst():GetCode())
              Debug.Message("restored to hand reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 182, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand", controller: 1 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHand"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1012, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHand"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1012, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
    assertPublicRestoreMetadata(restored, staleTrigger);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["sentToHand"]);
    expect(restored.host.messages).not.toContain("restored to hand trigger 200");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored to hand trigger 200");
    expect(restored.host.messages).toContain("restored to hand reason effect true");
  });

  it("makes Lua optional when to-hand triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Hand Boundary Source", kind: "monster" },
      { code: "200", name: "To Hand Boundary Target", kind: "monster" },
      { code: "300", name: "When To Hand Watcher", kind: "monster" },
      { code: "400", name: "If To Hand Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 181, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(source)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Duel.SendtoHand(target, 1, REASON_EFFECT)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(move)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_HAND)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to hand resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_HAND)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to hand resolved")
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
      "to-hand-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1012");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1012", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToHand", eventCode: 1012 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand", controller: 1 });
  });

  it("passes explicit Lua move reason players to triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reason Starter", kind: "monster" },
      { code: "200", name: "Reason Target", kind: "monster" },
      { code: "300", name: "Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 179, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Debug.Message("reason move count " .. Duel.SendtoGrave(target, REASON_EFFECT, PLAYER_NONE, 1))
      end)
      starter:RegisterEffect(move)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_TO_GRAVE)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("reason trigger " .. ep .. "/" .. rp .. "/" .. eg:GetFirst():GetReasonPlayer())
      end)
      watcher:RegisterEffect(e)
      `,
      "move-reason-player.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("reason move count 1");
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("reason trigger 0/1/1");
  });

  it("queues Lua to-deck triggers after cards move to deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Deck Starter", kind: "monster" },
      { code: "200", name: "To Deck Target", kind: "monster" },
      { code: "300", name: "To Deck Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 177, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Debug.Message("to deck event count " .. Duel.SendtoDeck(target, nil, SEQ_DECKTOP, REASON_EFFECT))
      end)
      starter:RegisterEffect(move)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_TO_DECK)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("to deck trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "to-deck-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("to deck event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "deck", controller: 0 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToDeck"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1013, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("to deck trigger resolved 200");
  });

  it("makes Lua optional when to-deck triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Deck Boundary Source", kind: "monster" },
      { code: "200", name: "To Deck Boundary Target", kind: "monster" },
      { code: "300", name: "When To Deck Watcher", kind: "monster" },
      { code: "400", name: "If To Deck Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 182, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(source)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Duel.SendtoDeck(target, nil, SEQ_DECKTOP, REASON_EFFECT)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(move)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_DECK)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to deck resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_DECK)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to deck resolved")
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
      "to-deck-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1013");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "deck", controller: 0 });
  });

  it("lets Lua scripts move cards to hand or fallback elsewhere", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Hand First", kind: "monster" },
      { code: "200", name: "Fallback Only", kind: "monster" },
      { code: "300", name: "No Legal Move", kind: "monster" },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.owner === 0)) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fallback = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local cannot_hand=Effect.CreateEffect(fallback)
      cannot_hand:SetType(EFFECT_TYPE_SINGLE)
      cannot_hand:SetCode(EFFECT_CANNOT_TO_HAND)
      fallback:RegisterEffect(cannot_hand)
      local blocked_cannot_hand=Effect.CreateEffect(blocked)
      blocked_cannot_hand:SetType(EFFECT_TYPE_SINGLE)
      blocked_cannot_hand:SetCode(EFFECT_CANNOT_TO_HAND)
      blocked:RegisterEffect(blocked_cannot_hand)
      Debug.Message("thoe hand " .. aux.ToHandOrElse(first,0) .. "/" .. first:GetLocation())
      Debug.Message("thoe fallback " .. aux.ToHandOrElse(fallback,0,function(c) return c:IsAbleToDeck() end,function(c) return Duel.SendtoDeck(c,0,0,REASON_EFFECT) end,574) .. "/" .. fallback:GetLocation())
      Debug.Message("thoe none " .. aux.ToHandOrElse(blocked,0,function(c) return false end,function(c) return Duel.SendtoDeck(c,0,0,REASON_EFFECT) end,574) .. "/" .. blocked:GetLocation())
      `,
      "to-hand-or-else.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("thoe hand 1/2");
    expect(host.messages).toContain("thoe fallback 1/1");
    expect(host.messages).toContain("thoe none 0/16");
  });

  it("lets Lua scripts take control of field cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self A", kind: "monster" },
      { code: "200", name: "Self B", kind: "monster" },
      { code: "300", name: "Self C", kind: "monster" },
      { code: "600", name: "Taken A", kind: "monster" },
      { code: "700", name: "Taken B", kind: "monster" },
      { code: "800", name: "Blocked", kind: "monster" },
    ];
    const session = createDuel({ seed: 41, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["600", "700", "800"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local taken = Duel.SelectMatchingCard(0, function(c) return c:IsCode(600) or c:IsCode(700) end, 0, 0, LOCATION_MZONE, 1, 2, nil)
      Debug.Message("take group " .. Duel.GetControl(taken, 0, 0, 0, LOCATION_MZONE))
      Debug.Message("take operated " .. Duel.GetOperatedGroup():GetCount())
      local first = Duel.GetOperatedGroup():GetFirst()
      Debug.Message("take first controller " .. first:GetControler())
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, 0, LOCATION_MZONE, 1, 1, nil)
      Debug.Message("take blocked " .. Duel.GetControl(blocked, 0, 0, 0, LOCATION_MZONE))
      Debug.Message("take blocked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("self mzone count " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("opponent mzone count " .. Duel.GetFieldGroupCount(1, LOCATION_MZONE, 0))
      Debug.Message("self usable mzone " .. Duel.GetUsableMZoneCount(0))
      Debug.Message("self usable excluding taken " .. Duel.GetUsableMZoneCount(0, taken))
      Debug.Message("opponent usable mzone " .. Duel.GetUsableMZoneCount(1))
      `,
      "get-control.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("take group 2");
    expect(host.messages).toContain("take operated 2");
    expect(host.messages).toContain("take first controller 0");
    expect(host.messages).toContain("take blocked 0");
    expect(host.messages).toContain("take blocked operated 0");
    expect(host.messages).toContain("self mzone count 5");
    expect(host.messages).toContain("opponent mzone count 1");
    expect(host.messages).toContain("self usable mzone 0");
    expect(host.messages).toContain("self usable excluding taken 2");
    expect(host.messages).toContain("opponent usable mzone 4");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
    expect(session.state.cards.find((card) => card.code === "800")).toMatchObject({ controller: 1, location: "monsterZone", sequence: 2 });
  });

  it("queues Lua control-change triggers after Duel.GetControl succeeds", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Watcher", kind: "monster" },
      { code: "600", name: "Control Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 65, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["600"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil)
      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_CONTROL_CHANGED)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("control trigger resolved " .. Duel.GetOperatedGroup():GetFirst():GetControler() .. "/" .. r .. "/" .. rp) end)
      watcher:RegisterEffect(e)
      Debug.Message("control trigger take " .. Duel.GetControl(target, 0, 0, 0, LOCATION_MZONE))
      `,
      "control-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("control trigger take 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["controlChanged"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1120, eventReason: 0x40, eventReasonPlayer: 0 });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("control trigger resolved 0/64/0");
  });

  it("makes Lua optional when control-change triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Boundary Source", kind: "monster" },
      { code: "300", name: "When Control Watcher", kind: "monster" },
      { code: "400", name: "If Control Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "600", name: "Control Boundary Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 183, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500"] },
      1: { main: ["600"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil)
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local take=Effect.CreateEffect(source)
      take:SetType(EFFECT_TYPE_IGNITION)
      take:SetRange(LOCATION_HAND)
      take:SetOperation(function(e,tp)
        Duel.GetControl(target, 0, 0, 0, LOCATION_MZONE)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(take)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_CONTROL_CHANGED)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when control resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_CONTROL_CHANGED)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if control resolved")
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
      "control-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1120");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "controlChanged", eventCode: 1120 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ location: "monsterZone", controller: 0 });
  });

  it("lets Lua scripts swap control of field cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Self", kind: "monster" },
      { code: "101", name: "Swap Self Filler A", kind: "monster" },
      { code: "102", name: "Swap Self Filler B", kind: "monster" },
      { code: "103", name: "Swap Self Filler C", kind: "monster" },
      { code: "104", name: "Swap Self Filler D", kind: "monster" },
      { code: "500", name: "Self Spell A", kind: "spell" },
      { code: "501", name: "Self Spell B", kind: "spell" },
      { code: "502", name: "Self Spell C", kind: "spell" },
      { code: "503", name: "Self Spell D", kind: "spell" },
      { code: "504", name: "Self Spell E", kind: "spell" },
      { code: "600", name: "Swap Opponent", kind: "monster" },
      { code: "601", name: "Swap Opponent Filler A", kind: "monster" },
      { code: "602", name: "Swap Opponent Filler B", kind: "monster" },
      { code: "603", name: "Swap Opponent Filler C", kind: "monster" },
      { code: "604", name: "Swap Opponent Filler D", kind: "monster" },
      { code: "900", name: "Opponent Spell", kind: "spell" },
    ];
    const session = createDuel({ seed: 63, startingHandSize: 10, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101", "102", "103", "104", "500", "501", "502", "503", "504"] },
      1: { main: ["600", "601", "602", "603", "604", "900"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.kind === "monster")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.kind === "spell")) {
      moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
    }
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.kind === "monster")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
    }
    const opponentSpell = session.state.cards.find((card) => card.controller === 1 && card.code === "900");
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local self_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("swap monsters " .. tostring(Duel.SwapControl(self_monster, opponent_monster)))
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("swap controllers " .. self_monster:GetControler() .. "/" .. opponent_monster:GetControler())
      local opponent_spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, 0, LOCATION_SZONE, 1, 1, nil):GetFirst()
      Debug.Message("swap blocked " .. tostring(Duel.SwapControl(opponent_monster, opponent_spell)))
      Debug.Message("swap blocked operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-control.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("swap monsters true");
    expect(host.messages).toContain("swap operated 2");
    expect(host.messages).toContain("swap controllers 1/0");
    expect(host.messages).toContain("swap blocked false");
    expect(host.messages).toContain("swap blocked operated 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "900")).toMatchObject({ controller: 1, location: "spellTrapZone" });
  });

  it("makes Lua optional when swap-control triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Boundary Source", kind: "monster" },
      { code: "200", name: "Swap Boundary Self", kind: "monster" },
      { code: "300", name: "When Swap Watcher", kind: "monster" },
      { code: "400", name: "If Swap Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "600", name: "Swap Boundary Opponent", kind: "monster" },
    ];
    const session = createDuel({ seed: 184, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: ["600"] },
    });
    startDuel(session);
    const selfTarget = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const opponentTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(selfTarget).toBeDefined();
    expect(opponentTarget).toBeDefined();
    moveDuelCard(session.state, selfTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local self_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local swap=Effect.CreateEffect(source)
      swap:SetType(EFFECT_TYPE_IGNITION)
      swap:SetRange(LOCATION_HAND)
      swap:SetOperation(function(e,tp)
        Duel.SwapControl(self_target, opponent_target)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(swap)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_CONTROL_CHANGED)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when swap resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_CONTROL_CHANGED)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if swap resolved")
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
      "swap-control-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1120");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "controlChanged", eventCode: 1120 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ location: "monsterZone", controller: 0 });
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
