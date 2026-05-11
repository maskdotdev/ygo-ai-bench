import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua release helpers", () => {
  it("lets Lua scripts check, select, and release monster-zone groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release A", kind: "monster" },
      { code: "300", name: "Release B", kind: "monster" },
      { code: "500", name: "Release C", kind: "monster" },
    ];
    const session = createDuel({ seed: 8, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["100", "300", "500"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc) return tc:IsCode(100) or tc:IsCode(300) end
      local vararg_filter = function(tc, mincode) return tc:GetCode() >= mincode end
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local field = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can release player " .. tostring(Duel.IsPlayerCanRelease(0)))
      Debug.Message("can release field " .. tostring(Duel.IsPlayerCanRelease(0, field)))
      Debug.Message("can release hand " .. tostring(Duel.IsPlayerCanRelease(1, hand)))
      Debug.Message("release group " .. Duel.GetReleaseGroup(0, filter, nil):GetCount())
      Debug.Message("release group count " .. Duel.GetReleaseGroupCount(0, filter, nil))
      Debug.Message("release group vararg " .. Duel.GetReleaseGroup(0, vararg_filter, nil, 300):GetCount())
      Debug.Message("release group count vararg " .. Duel.GetReleaseGroupCount(0, vararg_filter, nil, 300))
      local releasable, excluded_release = Duel.GetReleaseGroup(0):Split(aux.ReleaseCostFilter, nil, 0)
      Debug.Message("release cost split " .. releasable:GetCount() .. "/" .. excluded_release:GetCount())
      Debug.Message("can release two " .. tostring(Duel.CheckReleaseGroup(0, filter, 2, nil)))
      Debug.Message("can release three " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      Debug.Message("can release ex two " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 2, 2, nil)))
      Debug.Message("can release ex three " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 3, 3, nil)))
      local gx = Duel.SelectReleaseGroupEx(0, filter, 1, 1, nil)
      Debug.Message("selected releases ex " .. gx:GetCount())
      local g = Duel.SelectReleaseGroup(0, filter, 1, 2, nil)
      Debug.Message("selected releases " .. g:GetCount())
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("release group excluded " .. Duel.GetReleaseGroup(0, aux.TRUE, excluded):GetCount())
      Debug.Message("group excluded release check " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 3, excluded)))
      Debug.Message("group excluded release selected " .. Duel.SelectReleaseGroup(0, aux.TRUE, 1, 3, excluded):GetCount())
      local forced = excluded:GetFirst()
      Duel.SetSelectedCard(forced)
      Debug.Message("forced release check " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      local forced_group = Duel.SelectReleaseGroup(0, filter, 1, 3, nil)
      Debug.Message("forced release selected " .. forced_group:GetCount() .. " " .. tostring(forced_group:IsContains(forced)))
      Duel.SetSelectedCard(Group.FromCards(forced, g:GetFirst()))
      Debug.Message("forced release ex max miss " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 1, 1, nil)))
      Duel.SetSelectedCard(nil)
      Debug.Message("released " .. Duel.Release(g, REASON_COST))
      local released = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("previous location " .. tostring(released:IsPreviousLocation(LOCATION_MZONE)))
      Debug.Message("previous controller " .. tostring(released:IsPreviousControler(0)))
      Debug.Message("release reason " .. tostring(released:IsReason(REASON_RELEASE)) .. "/" .. tostring(released:IsReason(REASON_COST)))
      `,
      "release-group.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can release player true");
    expect(host.messages).toContain("can release field true");
    expect(host.messages).toContain("can release hand false");
    expect(host.messages).toContain("release group 2");
    expect(host.messages).toContain("release group count 2");
    expect(host.messages).toContain("release group vararg 2");
    expect(host.messages).toContain("release group count vararg 2");
    expect(host.messages).toContain("release cost split 3/0");
    expect(host.messages).toContain("can release two true");
    expect(host.messages).toContain("can release three false");
    expect(host.messages).toContain("can release ex two true");
    expect(host.messages).toContain("can release ex three false");
    expect(host.messages).toContain("selected releases ex 1");
    expect(host.messages).toContain("selected releases 2");
    expect(host.messages).toContain("release group excluded 2");
    expect(host.messages).toContain("group excluded release check false");
    expect(host.messages).toContain("group excluded release selected 2");
    expect(host.messages).toContain("forced release check true");
    expect(host.messages).toContain("forced release selected 3 true");
    expect(host.messages).toContain("forced release ex max miss false");
    expect(host.messages).toContain("released 2");
    expect(host.messages).toContain("previous location true");
    expect(host.messages).toContain("previous controller true");
    expect(host.messages).toContain("release reason true/true");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "graveyard" && (card.code === "100" || card.code === "300"))).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "500")?.location).toBe("monsterZone");
  });

  it("queues Lua release triggers after cards are released", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Starter", kind: "monster" },
      { code: "200", name: "Release Target", kind: "monster" },
      { code: "300", name: "Release Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 190, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const starter = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local release=Effect.CreateEffect(starter)
      release:SetType(EFFECT_TYPE_IGNITION)
      release:SetRange(LOCATION_MZONE)
      release:SetOperation(function(e,tp)
        Debug.Message("release event count " .. Duel.Release(target, REASON_COST))
      end)
      starter:RegisterEffect(release)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_RELEASE)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("release trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "release-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === starter!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    expect(host.messages).toContain("release event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["released"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1017, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });
    const trigger = getLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyResponse(session, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getLegalActions(session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(host.messages).toContain("release trigger resolved 200");
  });

  it("applies restored Lua release triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Release Starter", kind: "monster" },
      { code: "200", name: "Restore Release Target", kind: "monster" },
      { code: "300", name: "Restore Release Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_MZONE)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
              Duel.Release(target, REASON_COST)
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
            e:SetCode(EVENT_RELEASE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg)
              Debug.Message("restored release trigger " .. eg:GetFirst():GetCode())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 192, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === starter!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["released"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1017, eventCardUid: target!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["released"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1017, eventCardUid: target!.uid });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertPublicRestoreMetadata(restored, staleTrigger);
    expect(staleTrigger.legalActions).toEqual(getLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["released"]);
    expect(restored.host.messages).not.toContain("restored release trigger 200");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored release trigger 200");
  });

  it("makes Lua optional when release triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Boundary Starter", kind: "monster" },
      { code: "200", name: "Release Boundary Target", kind: "monster" },
      { code: "300", name: "When Release Watcher", kind: "monster" },
      { code: "400", name: "If Release Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 191, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const starter = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_MZONE)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
              Duel.Release(target, REASON_COST)
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
            e:SetCode(EVENT_RELEASE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when release resolved") end)
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
            e:SetCode(EVENT_RELEASE)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if release resolved") end)
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
    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === starter!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1017");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1017", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "released", eventCode: 1017 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1017");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1017", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const ifReleaseTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "lua-3-1017");
    expect(ifReleaseTrigger).toBeDefined();
    const ifReleaseResult = applyLuaRestoreAndAssert(restored, ifReleaseTrigger!);
    expect(ifReleaseResult.state.pendingTriggers.map((trigger) => trigger.effectId)).not.toContain("lua-2-1017");
    expect(restored.host.messages).not.toContain("when release resolved");
    expect(restored.host.messages).toContain("if release resolved");

    const damageTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "lua-4-1111");
    expect(damageTrigger).toBeDefined();
    const damageResult = applyLuaRestoreAndAssert(restored, damageTrigger!);
    expect(damageResult.state.pendingTriggers.map((trigger) => trigger.effectId)).not.toContain("lua-2-1017");
    expect(damageResult.state.pendingTriggers).toEqual([]);
    expect(restored.host.messages).not.toContain("when release resolved");
    expect(restored.host.messages).toContain("damage boundary resolved");
  });

  it("lets Lua scripts use self tribute cost aliases", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Self Tribute Cost", kind: "monster" }];
    const session = createDuel({ seed: 189, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Debug.Message("self tribute check " .. tostring(Cost.SelfTribute(e,0,Group.CreateGroup(),0,0,nil,0,0,0)) .. "/" .. tostring(Cost.SelfRelease(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.SelfRelease(e,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self tribute moved " .. tostring(c:IsLocation(LOCATION_GRAVE)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("self tribute reason " .. tostring(c:IsReason(REASON_RELEASE)) .. "/" .. tostring(c:IsReason(REASON_COST)))
      `,
      "self-tribute-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("self tribute check true/true");
    expect(host.messages).toContain("self tribute moved true/100");
    expect(host.messages).toContain("self tribute reason true/true");
  });

  it("lets Lua scripts check and select release cost groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Field A", kind: "monster" },
      { code: "300", name: "Cost Field B", kind: "monster" },
      { code: "500", name: "Cost Hand", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc, mincode) return tc:GetCode() >= mincode end
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("cost check field two " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 2, 2, false, nil, nil, 100)))
      Debug.Message("cost check hand miss " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, false, nil, nil, 100)))
      Debug.Message("cost check hand ok " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, true, nil, nil, 100)))
      Debug.Message("cost excluded " .. tostring(Duel.CheckReleaseGroupCost(0, filter, 3, 3, true, nil, excluded, 100)))
      local g = Duel.SelectReleaseGroupCost(0, filter, 1, 3, true, nil, nil, 100)
      Debug.Message("cost selected " .. g:GetCount())
      Debug.Message("cost contains hand " .. tostring(g:IsExists(Card.IsLocation, 1, nil, LOCATION_HAND)))
      `,
      "release-cost-group.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("cost check field two true");
    expect(host.messages).toContain("cost check hand miss false");
    expect(host.messages).toContain("cost check hand ok true");
    expect(host.messages).toContain("cost excluded false");
    expect(host.messages).toContain("cost selected 3");
    expect(host.messages).toContain("cost contains hand true");
  });

  it("lets Lua release cost checks use aux release predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Cost A", kind: "monster" },
      { code: "300", name: "Release Cost B", kind: "monster" },
      { code: "500", name: "Release Cost C", kind: "monster" },
      { code: "700", name: "Release Cost D", kind: "monster" },
      { code: "900", name: "Release Cost E", kind: "monster" },
      { code: "1100", name: "Target Group Card", kind: "monster" },
      { code: "1300", name: "Extra Zone Check Card", kind: "extra" },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "700", "900", "1100"], extra: ["1300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300", "500", "700", "900"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1300), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("release check mmz " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckMMZ, nil)))
      local mmz_group = Duel.SelectReleaseGroupCost(0, nil, 1, 1, false, aux.ReleaseCheckMMZ, nil)
      Debug.Message("release select mmz " .. mmz_group:GetCount() .. "/" .. Duel.GetMZoneCount(0, mmz_group))
      Debug.Message("release check target hit " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckTarget, nil, target)))
      Debug.Message("release check target miss " .. tostring(Duel.CheckReleaseGroupCost(0, nil, 1, false, aux.ReleaseCheckTarget, nil, mmz_group)))
      local hand_check = aux.ZoneCheckFunc(target:GetFirst(),0,0)
      local extra_check = aux.ZoneCheckFunc(extra,0,0)
      Debug.Message("zone check func " .. hand_check(mmz_group) .. "/" .. extra_check(mmz_group))
      `,
      "release-cost-aux-checks.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release check mmz true");
    expect(host.messages).toContain("release select mmz 1/1");
    expect(host.messages).toContain("release check target miss false");
    expect(host.messages).toContain("release check target hit true");
    expect(host.messages).toContain("zone check func 1/1");
  });

  it("lets Lua scripts identify opponent extra non-summon release effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Own Release Candidate", kind: "monster" },
      { code: "200", name: "Opponent Numeric Release", kind: "monster" },
      { code: "300", name: "Opponent Zero Release", kind: "monster" },
      { code: "400", name: "Opponent Function Release", kind: "monster" },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300", "400"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local own = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local numeric = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local zero = Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local function_card = Duel.GetFieldCard(1, LOCATION_MZONE, 2)
      local current = Effect.CreateEffect(own)
      local numeric_effect = Effect.CreateEffect(numeric)
      numeric_effect:SetType(EFFECT_TYPE_SINGLE)
      numeric_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      numeric_effect:SetValue(1)
      numeric:RegisterEffect(numeric_effect)
      local zero_effect = Effect.CreateEffect(zero)
      zero_effect:SetType(EFFECT_TYPE_SINGLE)
      zero_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      zero_effect:SetValue(0)
      zero:RegisterEffect(zero_effect)
      local function_effect = Effect.CreateEffect(function_card)
      function_effect:SetType(EFFECT_TYPE_SINGLE)
      function_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      function_effect:SetValue(function(e,ce,reason,tp) return ce==current and reason==REASON_COST and tp==0 end)
      function_card:RegisterEffect(function_effect)
      Debug.Message("release nonsum " .. tostring(aux.ReleaseNonSumCheck(own,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(numeric,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(zero,0,current)) .. "/" .. tostring(aux.ReleaseNonSumCheck(function_card,0,current)))
      Debug.Message("release nonsum wrong player " .. tostring(aux.ReleaseNonSumCheck(function_card,1,current)))
      `,
      "release-nonsum-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release nonsum false/true/false/true");
    expect(host.messages).toContain("release nonsum wrong player false");
  });

  it("lets release cost selection include opponent extra-release materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Own Cost", kind: "monster" },
      { code: "200", name: "Opponent Extra Cost", kind: "monster" },
      { code: "300", name: "Opponent Locked Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 22, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local extra = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local locked = Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local extra_effect = Effect.CreateEffect(extra)
      extra_effect:SetType(EFFECT_TYPE_SINGLE)
      extra_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      extra_effect:SetCountLimit(1)
      extra_effect:SetValue(1)
      extra:RegisterEffect(extra_effect)
      local locked_effect = Effect.CreateEffect(locked)
      locked_effect:SetType(EFFECT_TYPE_SINGLE)
      locked_effect:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      locked_effect:SetValue(0)
      locked:RegisterEffect(locked_effect)
      Debug.Message("extra release cost check " .. tostring(Duel.CheckReleaseGroupCost(0, aux.TRUE, 2, 2, false, nil, nil)))
      local g = Duel.SelectReleaseGroupCost(0, aux.TRUE, 1, 3, false, nil, nil)
      Debug.Message("extra release cost selected " .. g:GetCount() .. "/" .. tostring(g:IsContains(extra)) .. "/" .. tostring(g:IsContains(locked)))
      extra_effect:UseCountLimit(0)
      Debug.Message("extra release exhausted check " .. tostring(Duel.CheckReleaseGroupCost(0, aux.TRUE, 2, 2, false, nil, nil)))
      local exhausted = Duel.SelectReleaseGroupCost(0, aux.TRUE, 1, 3, false, nil, nil)
      Debug.Message("extra release exhausted selected " .. exhausted:GetCount() .. "/" .. tostring(exhausted:IsContains(extra)))
      `,
      "release-cost-extra-nonsum.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("extra release cost check true");
    expect(host.messages).toContain("extra release cost selected 2/true/false");
    expect(host.messages).toContain("extra release exhausted check false");
    expect(host.messages).toContain("extra release exhausted selected 1/false");
  });

  it("lets Lua scripts collect must-be material effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Synchro Must Material", kind: "monster" },
      { code: "300", name: "Function Must Material", kind: "monster" },
      { code: "900", name: "Summon Candidate", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "900"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_MUST_BE_MATERIAL)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(REASON_SYNCHRO)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_MUST_BE_MATERIAL)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(function(te,eg,sump,sc,g)
          if sump==0 and sc and sc:IsCode(900) then return REASON_FUSION end
          return 0
        end)
        c:RegisterEffect(e)
      end
      `,
      "must-be-material-effects.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const result = host.loadScript(
      `
      local sc = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local synchro = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_SYNCHRO)
      local fusion = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_FUSION)
      local ritual = aux.GetMustBeMaterialGroup(0, Group.CreateGroup(), 0, sc, nil, REASON_RITUAL)
      Debug.Message("must material constant " .. EFFECT_MUST_BE_MATERIAL)
      Debug.Message("must material synchro " .. synchro:GetCount() .. "/" .. tostring(synchro:GetFirst():IsCode(100)))
      Debug.Message("must material fusion " .. fusion:GetCount() .. "/" .. tostring(fusion:GetFirst():IsCode(300)))
      Debug.Message("must material ritual " .. ritual:GetCount())
      `,
      "must-be-material-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("must material constant 312");
    expect(host.messages).toContain("must material synchro 1/true");
    expect(host.messages).toContain("must material fusion 1/true");
    expect(host.messages).toContain("must material ritual 0");
  });

  it("excludes unreleasable cards from Lua release group helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Unreleasable Cost", kind: "monster" },
      { code: "300", name: "Releasable Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 81, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UNRELEASABLE_NONSUM)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "unreleasable-release-helper.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      Debug.Message("release check two " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 2, nil)))
      Debug.Message("release check one " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 1, nil)))
      local selected = Duel.SelectReleaseGroup(0, aux.TRUE, 1, 2, nil)
      Debug.Message("release selected " .. selected:GetCount())
      Debug.Message("release selected blocked " .. tostring(selected:IsExists(aux.FilterBoolFunction(Card.IsCode, 100), 1, nil)))
      local both = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_MZONE, 0, 1, 2, nil)
      Debug.Message("release moved " .. Duel.Release(both, REASON_COST))
      `,
      "unreleasable-release-helper-run.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("release check two false");
    expect(host.messages).toContain("release check one true");
    expect(host.messages).toContain("release selected 1");
    expect(host.messages).toContain("release selected blocked false");
    expect(host.messages).toContain("release moved 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
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
