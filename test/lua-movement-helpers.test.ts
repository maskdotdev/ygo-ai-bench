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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua movement helpers", () => {
  it("lets ChangePosition overloads use zero for unaffected current positions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Overloaded Position Target", kind: "monster" }];
    const session = createDuel({ seed: 348, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    const moved = moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    moved.faceUp = true;
    moved.position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("overload position " .. Duel.ChangePosition(c,0,0,POS_FACEUP_ATTACK,0))
      `,
      "change-position-zero-overload.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["overload position 1"]);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpAttack",
    });
  });

  it("lets Lua scripts remove cards from the duel", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Removed From Duel A", kind: "monster" },
      { code: "200", name: "Removed From Duel B", kind: "monster" },
      { code: "300", name: "Remaining Field", kind: "monster" },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local remove_group = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("remove cards result " .. Duel.RemoveCards(remove_group, 0, -2, REASON_RULE))
      Debug.Message("remove cards operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove cards field " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("remove cards hidden " .. Duel.GetMatchingGroupCount(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE + LOCATION_GRAVE + LOCATION_REMOVED, 0, nil))
      `,
      "remove-cards.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("remove cards result 2");
    expect(host.messages).toContain("remove cards operated 2");
    expect(host.messages).toContain("remove cards field 1");
    expect(host.messages).toContain("remove cards hidden 0");
    expect(session.state.cards.map((card) => card.code).sort()).toEqual(["300"]);
  });

  it("keeps remove-cards helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Remove A", kind: "monster" },
      { code: "200", name: "Ended Remove B", kind: "monster" },
    ];
    const session = createDuel({ seed: 229, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local remove_group = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_MZONE, 0, nil)
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("ended remove cards " .. Duel.RemoveCards(remove_group, 0, -2, REASON_RULE))
      Debug.Message("ended remove operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("ended remove field " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      `,
      "ended-remove-cards.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["ended remove cards 0", "ended remove operated 0", "ended remove field 2"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.cards.map((card) => card.code).sort()).toEqual(["100", "200"]);
  });

  it("lets Lua scripts banish cards face-down with the third-argument reason", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Hidden Banish", kind: "monster" }];
    const session = createDuel({ seed: 95, startingHandSize: 1, cardReader: createCardReader(cards) });
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
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("removed face-down " .. Duel.Remove(c, POS_FACEDOWN_DEFENSE, REASON_EFFECT))
      Debug.Message("removed state " .. tostring(c:IsLocation(LOCATION_REMOVED)) .. "/" .. tostring(c:IsFacedown()) .. "/" .. tostring(c:IsPublic()) .. "/" .. c:GetReason())
      `,
      "face-down-remove.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("removed face-down 1");
    expect(host.messages).toContain("removed state true/true/false/64");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({
      faceUp: false,
      location: "banished",
      position: "faceDownDefense",
      reason: 0x40,
    });
  });

  it("raises Lua leave-field triggers for cards moved from the field by effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leave Field Mover", kind: "monster" },
      { code: "200", name: "Leaving Monster", kind: "monster" },
      { code: "300", name: "Leave Field Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_LEAVE_FIELD)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local tc=eg:GetFirst()
          return tc and tc:IsCode(200) and tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_EFFECT)
        end)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("left field trigger " .. tc:GetCode() .. "/" .. tc:GetLeaveFieldDest())
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-trigger.lua",
    );

    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid !== mover!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("left field trigger 200/16");
  });

  it("raises Lua leave-grave triggers for cards moved from the graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Graveyard Mover", kind: "monster" },
      { code: "200", name: "Leaving Graveyard", kind: "monster" },
      { code: "300", name: "Leave Grave Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 166, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_GRAVE, 0, 1, 1, nil)
          Duel.SendtoHand(g, tp, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_LEAVE_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("left grave trigger " .. tc:GetCode() .. "/" .. tostring(tc:IsPreviousLocation(LOCATION_GRAVE)) .. "/" .. tostring(tc:IsLocation(LOCATION_HAND)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-grave-trigger.lua",
    );

    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["leftGraveyard"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1031, eventCardUid: leaving!.uid });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "leftGraveyard", eventCode: 1031, eventCardUid: leaving!.uid })]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid !== mover!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("left grave trigger 200/true/true");
  });

  it("applies restored Lua leave-field triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Field Mover", kind: "monster" },
      { code: "200", name: "Restore Leaving Field", kind: "monster" },
      { code: "300", name: "Restore Leave Field Watcher", kind: "monster" },
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
              local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil)
              Duel.SendtoGrave(g, REASON_EFFECT)
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
            e:SetCode(EVENT_LEAVE_FIELD)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              local tc=eg:GetFirst()
              return tc and tc:IsCode(200) and tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_EFFECT)
            end)
            e:SetOperation(function(e,tp,eg)
              local tc=eg:GetFirst()
              Debug.Message("restored left field " .. tc:GetCode() .. "/" .. tc:GetLeaveFieldDest())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 168, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["leftField"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["leftField"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1015, eventCardUid: leaving!.uid });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored left field 200/16");
  });

  it("applies restored Lua to-grave triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Grave Sender", kind: "monster" },
      { code: "200", name: "Restore Grave Target", kind: "monster" },
      { code: "300", name: "Restore To Grave Watcher", kind: "monster" },
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
              local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil)
              Duel.SendtoGrave(g, REASON_EFFECT)
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
            e:SetCode(EVENT_TO_GRAVE)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              local tc=eg:GetFirst()
              return tc and tc:IsCode(200) and tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_EFFECT)
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              local tc=eg:GetFirst()
              Debug.Message("restored to grave " .. tc:GetCode() .. "/" .. tostring(tc:IsLocation(LOCATION_GRAVE)))
              Debug.Message("restored to grave reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 169, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const sender = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(sender).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, sender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sender!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("sentToGraveyard");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventCode: 1014, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: sender!.uid, eventReasonEffectId: 1 }));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("sentToGraveyard");
    expect(restored.session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventCode: 1014, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: sender!.uid, eventReasonEffectId: 1 }));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored to grave 200/true");
    expect(restored.host.messages).toContain("restored to grave reason effect true");
  });

  it("applies restored Lua leave-grave triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Graveyard Mover", kind: "monster" },
      { code: "200", name: "Restore Leaving Graveyard", kind: "monster" },
      { code: "300", name: "Restore Leave Grave Watcher", kind: "monster" },
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
              local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_GRAVE, 0, 1, 1, nil)
              Duel.SendtoHand(g, tp, REASON_EFFECT)
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
            e:SetCode(EVENT_LEAVE_GRAVE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg)
              local tc=eg:GetFirst()
              Debug.Message("restored left grave " .. tc:GetCode() .. "/" .. tostring(tc:IsPreviousLocation(LOCATION_GRAVE)) .. "/" .. tostring(tc:IsLocation(LOCATION_HAND)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 167, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["leftGraveyard"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["leftGraveyard"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1031, eventCardUid: leaving!.uid });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored left grave 200/true/true");
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
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  }
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
