import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua control and return restore helpers", () => {
  it("restores to-hand missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore To Hand Boundary Source", kind: "monster" },
      { code: "200", name: "Restore To Hand Boundary Target", kind: "monster" },
      { code: "300", name: "Restore When To Hand Watcher", kind: "monster" },
      { code: "400", name: "Restore If To Hand Watcher", kind: "monster" },
      { code: "500", name: "Restore To Hand Damage Watcher", kind: "monster" },
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
            e:SetCode(EVENT_TO_HAND)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when to hand resolved") end)
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
            e:SetCode(EVENT_TO_HAND)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if to hand resolved") end)
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
    const session = createDuel({ seed: 181, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: ["200"] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

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

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1012");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1012", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1012");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1012", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1012")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1012")).toBe(false);
  });

  it("applies restored Lua to-deck triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore To Deck Starter", kind: "monster" },
      { code: "200", name: "Restore To Deck Target", kind: "monster" },
      { code: "300", name: "Restore To Deck Watcher", kind: "monster" },
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
              Duel.SendtoDeck(target, nil, SEQ_DECKTOP, REASON_EFFECT)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg)
              Debug.Message("restored to deck trigger " .. eg:GetFirst():GetCode())
              Debug.Message("restored to deck reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 183, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const starterScript = host.loadCardScript(100, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(starterScript.ok, starterScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    const starter = session.state.cards.find((card) => card.code === "100");
    const moved = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(moved).toMatchObject({ location: "deck", controller: 0 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToDeck"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1013, eventCardUid: moved!.uid, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToDeck"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1013, eventCardUid: moved!.uid, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 0).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === trigger!.effectId))).toBe(true);
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["sentToDeck"]);
    expect(restored.host.messages).not.toContain("restored to deck trigger 200");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored to deck trigger 200");
    expect(restored.host.messages).toContain("restored to deck reason effect true");
    const staleReplay = applyLuaRestoreResponse(restored, trigger!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });

  it("restores to-deck missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore To Deck Boundary Source", kind: "monster" },
      { code: "200", name: "Restore To Deck Boundary Target", kind: "monster" },
      { code: "300", name: "Restore When To Deck Watcher", kind: "monster" },
      { code: "400", name: "Restore If To Deck Watcher", kind: "monster" },
      { code: "500", name: "Restore To Deck Damage Watcher", kind: "monster" },
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
              Duel.SendtoDeck(target, nil, SEQ_DECKTOP, REASON_EFFECT)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when to deck resolved") end)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if to deck resolved") end)
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
    const session = createDuel({ seed: 182, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

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

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1013");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1013");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1013")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1013")).toBe(false);
  });

  it("restores to-extra-deck missed timing as EVENT_TO_DECK after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore To Extra Boundary Source", kind: "monster" },
      { code: "200", name: "Restore To Extra Boundary Target", kind: "extra" },
      { code: "300", name: "Restore When To Extra Watcher", kind: "monster" },
      { code: "400", name: "Restore If To Extra Watcher", kind: "monster" },
      { code: "500", name: "Restore To Extra Damage Watcher", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              Duel.SendtoExtra(target, nil, REASON_EFFECT)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when to extra resolved") end)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if to extra resolved") end)
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
    const session = createDuel({ seed: 185, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"], extra: ["200"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1013");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "extraDeck", controller: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1013");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1013");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1013")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1013")).toBe(false);
  });

  it("restores generic to-extra-deck sends as EVENT_TO_DECK after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Generic To Extra Boundary Source", kind: "monster" },
      { code: "200", name: "Restore Generic To Extra Boundary Target", kind: "extra" },
      { code: "300", name: "Restore When Generic To Extra Watcher", kind: "monster" },
      { code: "400", name: "Restore If Generic To Extra Watcher", kind: "monster" },
      { code: "500", name: "Restore Generic To Extra Damage Watcher", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              Duel.Sendto(target, LOCATION_EXTRA, REASON_EFFECT, POS_FACEDOWN_DEFENSE)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when generic to extra resolved") end)
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
            e:SetCode(EVENT_TO_DECK)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if generic to extra resolved") end)
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
            e:SetOperation(function(e,tp) Debug.Message("generic damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 186, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"], extra: ["200"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1013");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "extraDeck", controller: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1013");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1013");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1013", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1013")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1013")).toBe(false);
  });

  it("applies restored Lua control-change triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Control Watcher", kind: "monster" },
      { code: "600", name: "Restore Control Target", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_CONTROL_CHANGED)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored control trigger " .. eg:GetFirst():GetControler() .. "/" .. r .. "/" .. rp)
            Debug.Message("restored control reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
          end)
          c:RegisterEffect(e)

          local move=Effect.CreateEffect(c)
          move:SetType(EFFECT_TYPE_IGNITION)
          move:SetRange(LOCATION_HAND)
          move:SetOperation(function(e,tp)
            local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil)
            Duel.GetControl(target, 0, 0, 0, LOCATION_MZONE)
          end)
          c:RegisterEffect(move)
        end
        `;
      },
    };
    const session = createDuel({ seed: 184, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["600"] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    const sourceCard = session.state.cards.find((card) => card.code === "100");
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(sourceCard).toBeDefined();
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["controlChanged"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1120, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: sourceCard!.uid, eventReasonEffectId: 2 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["controlChanged"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1120, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: sourceCard!.uid, eventReasonEffectId: 2 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 0).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === trigger!.effectId))).toBe(true);
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["controlChanged"]);
    expect(restored.host.messages).not.toContain("restored control trigger 0/64/0");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored control trigger 0/64/0");
    expect(restored.host.messages).toContain("restored control reason effect true");
    const staleReplay = applyLuaRestoreResponse(restored, trigger!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });

  it("restores control-change missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Control Boundary Source", kind: "monster" },
      { code: "300", name: "Restore When Control Watcher", kind: "monster" },
      { code: "400", name: "Restore If Control Watcher", kind: "monster" },
      { code: "500", name: "Restore Control Damage Watcher", kind: "monster" },
      { code: "600", name: "Restore Control Boundary Target", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil)
              Duel.GetControl(target, 0, 0, 0, LOCATION_MZONE)
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
            e:SetCode(EVENT_CONTROL_CHANGED)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when control resolved") end)
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
            e:SetCode(EVENT_CONTROL_CHANGED)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if control resolved") end)
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
    const session = createDuel({ seed: 183, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: ["600"] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

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

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1120");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1120");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1120")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1120")).toBe(false);
  });

  it("restores swap-control missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Swap Boundary Source", kind: "monster" },
      { code: "200", name: "Restore Swap Boundary Self", kind: "monster" },
      { code: "300", name: "Restore When Swap Watcher", kind: "monster" },
      { code: "400", name: "Restore If Swap Watcher", kind: "monster" },
      { code: "500", name: "Restore Swap Damage Watcher", kind: "monster" },
      { code: "600", name: "Restore Swap Boundary Opponent", kind: "monster" },
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
              local self_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              local opponent_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
              Duel.SwapControl(self_target, opponent_target)
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
            e:SetCode(EVENT_CONTROL_CHANGED)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when swap resolved") end)
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
            e:SetCode(EVENT_CONTROL_CHANGED)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if swap resolved") end)
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
    const session = createDuel({ seed: 184, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: ["600"] } });
    startDuel(session);
    const selfTarget = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const opponentTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
    expect(selfTarget).toBeDefined();
    expect(opponentTarget).toBeDefined();
    moveDuelCard(session.state, selfTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

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

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1120");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1120");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1120", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1120")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1120")).toBe(false);
  });
});

function getLuaRestoreTriggerEffectIds(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1): string[] {
  return getLuaRestoreLegalActions(restored, player).flatMap((action) => (action.type === "activateTrigger" ? [action.effectId] : []));
}

function hasGroupedTrigger(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  }
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}
