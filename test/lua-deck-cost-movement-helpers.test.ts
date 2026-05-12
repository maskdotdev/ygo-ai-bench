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

describe("Lua deck and cost movement helpers", () => {
  it("lets Lua scripts pay Ice Barrier discard costs", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Discard Cost", kind: "monster" },
      { code: "200", name: "Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const replacement = session.state.cards.find((card) => card.code === "200");
    expect(replacement).toBeDefined();
    moveDuelCard(session.state, replacement!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local discard=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local replacement=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local re=Effect.CreateEffect(replacement)
      re:SetType(EFFECT_TYPE_SINGLE)
      re:SetCode(EFFECT_ICEBARRIER_REPLACE)
      re:SetRange(LOCATION_GRAVE)
      re:SetCountLimit(1, CARD_REVEALER_ICEBARRIER)
      replacement:RegisterEffect(re)
      local e=Effect.CreateEffect(discard)
      local cost=aux.IceBarrierDiscardCost(nil,true,1,1)
      Debug.Message("ice constants " .. EFFECT_ICEBARRIER_REPLACE .. "/" .. CARD_REVEALER_ICEBARRIER)
      Debug.Message("ice hand check " .. tostring(cost(e,0,nil,0,0,nil,0,0,0)))
      Debug.Message("ice hand paid " .. cost(e,0,nil,0,0,nil,0,0,1) .. "/" .. tostring(discard:IsLocation(LOCATION_GRAVE)))
      local replacement_only=aux.IceBarrierDiscardCost(function(c) return false end,true,1,1)
      Debug.Message("ice replace check " .. tostring(replacement_only(e,0,nil,0,0,nil,0,0,0)) .. "/" .. tostring(re:CheckCountLimit(0)))
      Debug.Message("ice replace paid " .. replacement_only(e,0,nil,0,0,nil,0,0,1) .. "/" .. tostring(replacement:IsLocation(LOCATION_REMOVED)) .. "/" .. tostring(re:CheckCountLimit(0)))
      `,
      "ice-barrier-discard-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("ice constants 18319762/18319762");
    expect(host.messages).toContain("ice hand check true");
    expect(host.messages).toContain("ice hand paid 1/true");
    expect(host.messages).toContain("ice replace check true/true");
    expect(host.messages).toContain("ice replace paid 1/true/false");
  });

  it("queues Lua discard triggers after cards are discarded", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Discard Starter", kind: "monster" },
      { code: "200", name: "Discard Target", kind: "monster" },
      { code: "300", name: "Discard Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 3, cardReader: createCardReader(cards) });
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

      local discard=Effect.CreateEffect(starter)
      discard:SetType(EFFECT_TYPE_IGNITION)
      discard:SetRange(LOCATION_HAND)
      discard:SetOperation(function(e,tp)
        Debug.Message("discard event count " .. Duel.SendtoGrave(target, REASON_DISCARD+REASON_COST))
      end)
      starter:RegisterEffect(discard)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_DISCARD)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("discard trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "discard-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("discard event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["discarded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1018, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("discard trigger resolved 200");
  });

  it("applies restored Lua discard triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Discard Starter", kind: "monster" },
      { code: "200", name: "Restore Discard Target", kind: "monster" },
      { code: "300", name: "Restore Discard Watcher", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
              Duel.SendtoGrave(target, REASON_DISCARD+REASON_COST)
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
            e:SetCode(EVENT_DISCARD)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored discard trigger " .. eg:GetFirst():GetCode())
              Debug.Message("restored discard reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 186, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    const discarded = session.state.cards.find((card) => card.code === "200");
    expect(discarded).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["discarded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1018, eventCardUid: discarded!.uid, eventReason: 0x4080, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["discarded"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1018, eventCardUid: discarded!.uid, eventReason: 0x4080, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
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
    assertPublicRestoreMetadata(restored, staleTrigger);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["discarded"]);
    expect(restored.host.messages).not.toContain("restored discard trigger 200");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored discard trigger 200");
    expect(restored.host.messages).toContain("restored discard reason effect true");
  });

  it("makes Lua optional when discard triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Discard Boundary Starter", kind: "monster" },
      { code: "200", name: "Discard Boundary Target", kind: "monster" },
      { code: "300", name: "When Discard Watcher", kind: "monster" },
      { code: "400", name: "If Discard Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 185, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const scriptName = "discard-later-boundary-missed-timing.lua";
    const script = `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local discard=Effect.CreateEffect(starter)
      discard:SetType(EFFECT_TYPE_IGNITION)
      discard:SetRange(LOCATION_HAND)
      discard:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_DISCARD+REASON_COST)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      starter:RegisterEffect(discard)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_DISCARD)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when discard resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_DISCARD)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if discard resolved")
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
      `;
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
              Duel.SendtoGrave(target, REASON_DISCARD+REASON_COST)
              Duel.Damage(1, 100, REASON_EFFECT)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DISCARD)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when discard resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DISCARD)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if discard resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          c500={}
          function c500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const loaded = host.loadScript(script, scriptName);
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1018");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1018", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCode: 1018 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1018");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1018", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });

  it("makes earlier Lua optional when triggers miss timing at draw boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw Boundary Source", kind: "monster" },
      { code: "200", name: "Draw Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Draw Boundary Watcher", kind: "monster" },
      { code: "600", name: "Drawn Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 179, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);
    const drawnCard = session.state.cards.find((card) => card.code === "600");
    expect(drawnCard).toBeDefined();
    moveDuelCard(session.state, drawnCard!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local draw_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.Draw(0, 1, REASON_EFFECT)
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

      local draw_effect=Effect.CreateEffect(draw_watcher)
      draw_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      draw_effect:SetCode(EVENT_DRAW)
      draw_effect:SetRange(LOCATION_HAND)
      draw_effect:SetOperation(function(e,tp)
        Debug.Message("draw boundary resolved")
      end)
      draw_watcher:RegisterEffect(draw_effect)
      `,
      "draw-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1110"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110 })]),
    );
    expect(session.state.cards.find((card) => card.code === "600")?.location).toBe("hand");
  });

  it("makes Lua optional when draw triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Draw Watcher", kind: "monster" },
      { code: "400", name: "If Draw Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "600", name: "Later Drawn Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 180, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);
    const drawnCard = session.state.cards.find((card) => card.code === "600");
    expect(drawnCard).toBeDefined();
    moveDuelCard(session.state, drawnCard!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const scriptName = "draw-later-boundary-missed-timing.lua";
    const script = `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.Draw(0, 1, REASON_EFFECT)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_DRAW)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when draw resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_DRAW)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if draw resolved")
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
      `;
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
              Duel.Draw(0, 1, REASON_EFFECT)
              Duel.Damage(1, 100, REASON_EFFECT)
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
            e:SetCode(EVENT_DRAW)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when draw resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DRAW)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if draw resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          c500={}
          function c500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c600.lua") {
          return `
          c600={}
          function c600.initial_effect(c)
          end
          `;
        }
        return undefined;
      },
    };
    const loaded = host.loadScript(script, scriptName);
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1110");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1110", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1110");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1110", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });

  it("lets Lua scripts special summon into an explicit monster zone", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Filler", kind: "monster" },
      { code: "200", name: "Zone Summon Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 117, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const filler = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(filler).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, filler!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("zone summon blocked " .. Duel.SpecialSummon(target,0,0,0,false,false,POS_FACEUP_ATTACK,0x1))
      Debug.Message("zone summon allowed " .. Duel.SpecialSummon(target,0,0,0,false,false,POS_FACEUP_ATTACK,0x4))
      Debug.Message("zone summon seq " .. target:GetSequence())
      `,
      "zone-special-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("zone summon blocked 0");
    expect(host.messages).toContain("zone summon allowed 1");
    expect(host.messages).toContain("zone summon seq 2");
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", sequence: 2 });
  });

  it("lets Lua scripts use self-banish cost aliases", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Banish Cost", kind: "monster" }];
    const session = createDuel({ seed: 83, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Debug.Message("self banish check " .. tostring(Cost.SelfBanish(e,0,Group.CreateGroup(),0,0,nil,0,0,0)) .. "/" .. tostring(aux.bfgcost(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      aux.bfgcost(e,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self banish moved " .. tostring(c:IsLocation(LOCATION_REMOVED)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "self-banish-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("self banish check true/true");
    expect(host.messages).toContain("self banish moved true/100");
  });

  it("lets Lua scripts use self movement and reveal cost aliases", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reveal Cost", kind: "monster" },
      { code: "200", name: "Hand Cost", kind: "monster" },
      { code: "300", name: "Deck Cost", kind: "monster" },
      { code: "900", name: "Extra Cost", kind: "extra" },
    ];
    const session = createDuel({ seed: 84, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);
    const handCost = session.state.cards.find((card) => card.code === "200");
    const extraCost = session.state.cards.find((card) => card.code === "900");
    expect(handCost).toBeDefined();
    expect(extraCost).toBeDefined();
    moveDuelCard(session.state, handCost!.uid, "monsterZone", 0);
    moveDuelCard(session.state, extraCost!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local reveal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local deck=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local extra=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local reveal_effect=Effect.CreateEffect(reveal)
      local hand_effect=Effect.CreateEffect(hand)
      local deck_effect=Effect.CreateEffect(deck)
      local extra_effect=Effect.CreateEffect(extra)
      Debug.Message("self reveal check " .. tostring(Cost.SelfReveal(reveal_effect,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.SelfReveal(reveal_effect,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self reveal stayed " .. tostring(reveal:IsLocation(LOCATION_HAND)))
      Debug.Message("self hand check " .. tostring(Cost.SelfToHand(hand_effect,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.SelfToHand(hand_effect,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self hand moved " .. tostring(hand:IsLocation(LOCATION_HAND)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("self deck check " .. tostring(Cost.SelfToDeck(deck_effect,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.SelfToDeck(deck_effect,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self deck moved " .. tostring(deck:IsLocation(LOCATION_DECK)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("self extra check " .. tostring(Cost.SelfToExtra(extra_effect,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.SelfToExtra(extra_effect,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self extra moved " .. tostring(extra:IsLocation(LOCATION_EXTRA)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "self-cost-aliases.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("self reveal check true");
    expect(host.messages).toContain("confirmed 1: 100");
    expect(host.messages).toContain("self reveal stayed true");
    expect(host.messages).toContain("self hand check true");
    expect(host.messages).toContain("self hand moved true/200");
    expect(host.messages).toContain("self deck check true");
    expect(host.messages).toContain("self deck moved true/300");
    expect(host.messages).toContain("self extra check true");
    expect(host.messages).toContain("self extra moved true/900");
  });

  it("lets Lua scripts move cards to the deck top", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Top A", kind: "monster" },
      { code: "200", name: "Top B", kind: "monster" },
      { code: "300", name: "Top C", kind: "monster" },
      { code: "400", name: "Top D", kind: "monster" },
      { code: "900", name: "Top Hand", kind: "monster" },
    ];
    const session = createDuel({ seed: 74, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900", "100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const initialDeckOrder = getCards(session.state, 0, "deck").map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top3 = Duel.GetDecktopGroup(0, 3)
      local third = top3:GetFirst()
      third = top3:GetNext()
      third = top3:GetNext()
      Debug.Message("top card " .. Duel.MoveToDeckTop(third, 0))
      Debug.Message("top card operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("top hand " .. Duel.MoveToDeckTop(hand, 0, REASON_EFFECT))
      Debug.Message("top hand operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("draw top " .. Duel.Draw(0, 1, REASON_EFFECT))
      Debug.Message("drawn card " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "move-to-deck-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("top card 1");
    expect(host.messages).toContain(`top card operated ${initialDeckOrder[2]}`);
    expect(host.messages).toContain("top hand 1");
    expect(host.messages).toContain("top hand operated 900");
    expect(host.messages).toContain("draw top 1");
    expect(host.messages).toContain("drawn card 900");
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual([
      initialDeckOrder[2]!,
      initialDeckOrder[0]!,
      initialDeckOrder[1]!,
      initialDeckOrder[3]!,
    ]);
  });

  it("lets Lua scripts move cards to the deck bottom", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Bottom A", kind: "monster" },
      { code: "200", name: "Bottom B", kind: "monster" },
      { code: "300", name: "Bottom C", kind: "monster" },
      { code: "400", name: "Bottom D", kind: "monster" },
      { code: "500", name: "Bottom E", kind: "monster" },
      { code: "900", name: "Bottom Grave", kind: "monster" },
    ];
    const session = createDuel({ seed: 72, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "900"] },
      1: { main: [] },
    });
    startDuel(session);

    const graveCard = session.state.cards.find((card) => card.code === "900");
    expect(graveCard).toBeDefined();
    moveDuelCard(session.state, graveCard!.uid, "graveyard", 0);
    const initialDeckOrder = getCards(session.state, 0, "deck").map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("bottom number " .. Duel.MoveToDeckBottom(1, 0))
      Debug.Message("bottom number operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local top2 = Duel.GetDecktopGroup(0, 2)
      Debug.Message("bottom group " .. Duel.MoveToDeckBottom(top2, 0))
      Debug.Message("bottom group operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local grave = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("bottom grave " .. Duel.MoveToDeckBottom(grave, 0, REASON_EFFECT))
      Debug.Message("bottom grave operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "move-to-deck-bottom.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("bottom number 1");
    expect(host.messages).toContain(`bottom number operated ${initialDeckOrder[0]}`);
    expect(host.messages).toContain("bottom group 2");
    expect(host.messages).toContain(`bottom group operated 2/${initialDeckOrder[1]}`);
    expect(host.messages).toContain("bottom grave 1");
    expect(host.messages).toContain("bottom grave operated 900");
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual([
      ...initialDeckOrder.slice(3),
      initialDeckOrder[0]!,
      initialDeckOrder[1]!,
      initialDeckOrder[2]!,
      "900",
    ]);
  });

  it("lets Lua scripts swap the deck and graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Deck A", kind: "monster" },
      { code: "200", name: "Swap Deck B", kind: "monster" },
      { code: "300", name: "Swap Grave A", kind: "monster" },
      { code: "400", name: "Swap Grave B", kind: "monster" },
      { code: "500", name: "Swap Grave C", kind: "monster" },
    ];
    const session = createDuel({ seed: 177, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("swap before " .. Duel.GetFieldGroupCount(0, LOCATION_DECK, 0) .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE, 0))
      Duel.SwapDeckAndGrave(0)
      Debug.Message("swap after " .. Duel.GetFieldGroupCount(0, LOCATION_DECK, 0) .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE, 0))
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-deck-and-grave.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("swap before 2/3");
    expect(host.messages).toContain("swap after 3/2");
    expect(host.messages).toContain("swap operated 5");
    expect(getCards(session.state, 0, "deck").map((card) => card.code).sort()).toEqual(["300", "400", "500"]);
    expect(getCards(session.state, 0, "graveyard").map((card) => card.code)).toEqual(["100", "200"]);
    expect(getCards(session.state, 0, "deck").every((card) => card.previousLocation === "graveyard")).toBe(true);
    expect(getCards(session.state, 0, "graveyard").every((card) => card.previousLocation === "deck")).toBe(true);
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
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  }
}
