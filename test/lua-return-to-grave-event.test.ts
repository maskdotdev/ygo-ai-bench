import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua return-to-grave events", () => {
  it("preserves active Lua reason source metadata for return-to-grave triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Reason Source", kind: "monster" },
      { code: "200", name: "Return Reason Target", kind: "monster" },
      { code: "300", name: "Return Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 289, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Duel.Remove(tc, POS_FACEUP, REASON_EFFECT+REASON_TEMPORARY)
          Duel.ReturnToGrave(tc)
          Debug.Message("return reason source " .. tostring(tc:GetReasonCard()==c) .. "/" .. tostring(tc:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local returned=eg:GetFirst()
          Debug.Message("return event reason source " .. tostring(returned:GetReasonCard():IsCode(100)) .. "/" .. tostring(returned:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-grave-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(watcher).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("return reason source true/true");
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "returnedToGraveyard", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("return event reason source true/true");
  });

  it("queues return-to-grave triggers when Lua returns a banished card to the Graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Source", kind: "monster" },
      { code: "200", name: "Return Target", kind: "monster" },
      { code: "300", name: "Return Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 204, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
          Debug.Message("banish count " .. Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY))
          Debug.Message("return count " .. Duel.ReturnToGrave(tc))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("return trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-grave-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const target = session.state.cards.find((card) => card.code === "200");
    expect(host.messages).toContain("banish count 1");
    expect(host.messages).toContain("return count 1");
    expect(target).toMatchObject({ location: "graveyard", reason: 0x20000 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["returnedToGraveyard"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1203, eventCardUid: target!.uid, eventReason: 0x20000, eventReasonPlayer: 0 });
    expect(session.state.eventHistory).toEqual([
      expect.objectContaining({ eventName: "chainActivating", eventCode: 1021 }),
      expect.objectContaining({ eventName: "chaining", eventCode: 1027 }),
      expect.objectContaining({ eventName: "chainSolving", eventCode: 1020 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "banished", eventCode: 1011 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "returnedToGraveyard", eventCode: 1203, eventReason: 0x20000, eventReasonPlayer: 0 }),
      expect.objectContaining({ eventName: "chainSolved", eventCode: 1022 }),
    ]);
  });

  it("applies restored Lua return-to-grave triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Return Source", kind: "monster" },
      { code: "200", name: "Restore Return Target", kind: "monster" },
      { code: "300", name: "Restore Return Watcher", kind: "monster" },
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
              local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
              Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY)
              Duel.ReturnToGrave(tc)
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
            e:SetCode(EVENT_RETURN_TO_GRAVE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored return trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 209, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["returnedToGraveyard"]);
    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["returnedToGraveyard"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1203, eventCardUid: target!.uid, eventReason: 0x20000, eventReasonPlayer: 0 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, trigger!, 0);
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    assertPublicRestoreMetadata(restored, originalTriggerPreapply);
    expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored return trigger 200/131072/0");
  });

  it("makes Lua optional when return-to-grave triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Boundary Source", kind: "monster" },
      { code: "200", name: "Return Boundary Target", kind: "monster" },
      { code: "300", name: "When Return Watcher", kind: "monster" },
      { code: "400", name: "If Return Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 265, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

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
              local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
              Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY)
              Duel.ReturnToGrave(tc)
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
            e:SetCode(EVENT_RETURN_TO_GRAVE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Debug.Message("when return resolved")
            end)
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
            e:SetCode(EVENT_RETURN_TO_GRAVE)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Debug.Message("if return resolved")
            end)
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
            e:SetOperation(function(e,tp)
              Debug.Message("damage boundary resolved")
            end)
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

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1203");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1203", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "returnedToGraveyard", eventCode: 1203 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1203");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1203", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok).toBe(true);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertPublicRestoreMetadata(restored: Parameters<typeof applyLuaRestoreResponse>[0], response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  }
}

function expectLuaRestoreStalePreapply(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const response = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(response.ok).toBe(false);
  expect(response.error).toContain("Response is not currently legal");
  expect(response.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
