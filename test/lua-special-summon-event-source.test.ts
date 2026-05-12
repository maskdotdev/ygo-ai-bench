import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua special summon event sources", () => {
  it("collects success triggers for Lua Extra Deck SpecialSummonStep", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Step Source", kind: "monster" },
      { code: "300", name: "Extra Step Watcher", kind: "monster" },
      { code: "900", name: "Step-Summoned Xyz", kind: "extra", typeFlags: 0x800001, level: 4 },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
              if Duel.SpecialSummonStep(target, SUMMON_TYPE_XYZ, tp, tp, false, false, POS_FACEUP_ATTACK) then
                Debug.Message("extra step complete " .. Duel.SpecialSummonComplete())
                target:CompleteProcedure()
              end
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
            e:SetCode(EVENT_SPSUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("extra step trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 151, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const starter = session.state.cards.find((card) => card.code === "100");
    const summoned = session.state.cards.find((card) => card.code === "900");
    expect(starter).toBeDefined();
    expect(summoned).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, summonType: "xyz" });
    expect(host.messages).toContain("extra step complete 1");
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({
      eventName: "specialSummoned",
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReason: 0x810,
      eventReasonPlayer: 0,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("extra step trigger 900/2064/0");
  });

  it("collects success triggers for Lua Extra Deck Special Summons", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Summon Source", kind: "monster" },
      { code: "300", name: "Extra Summon Watcher", kind: "monster" },
      { code: "900", name: "Effect-Summoned Fusion", kind: "extra" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
              Duel.SpecialSummon(target, SUMMON_TYPE_FUSION, tp, tp, false, false, POS_FACEUP_ATTACK)
              target:CompleteProcedure()
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
            e:SetCode(EVENT_SPSUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("extra special summon trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 150, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const starter = session.state.cards.find((card) => card.code === "100");
    const summoned = session.state.cards.find((card) => card.code === "900");
    expect(starter).toBeDefined();
    expect(summoned).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, summonType: "fusion" });
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({
      eventName: "specialSummoned",
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReason: 0x810,
      eventReasonPlayer: 0,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("extra special summon trigger 900/2064/0");
  });

  it("preserves active Lua effect sources on restored special summon events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source Starter", kind: "monster" },
      { code: "200", name: "Summon Source Target", kind: "monster" },
      { code: "300", name: "Summon Source Watcher", kind: "monster" },
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
              Duel.SpecialSummon(target, 0, tp, tp, false, false, POS_FACEUP_ATTACK)
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
            e:SetCode(EVENT_SPSUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored special summon trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
              Debug.Message("restored special summon reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 149, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    const summoned = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(summoned).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReason: 0x810,
      eventReasonPlayer: 0,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });
    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, trigger!, 0);
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, originalTriggerPreapply, 0);
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored special summon trigger 200/2064/0");
    expect(restored.host.messages).toContain("restored special summon reason effect true");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, result, result.state.waitingFor!);
  return result;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, result: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(result.state.actionWindowId).toBe(windowId);
  expect(result.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(result.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(result.state).not.toHaveProperty("triggerOrderPrompt");
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  for (const legalAction of result.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: result.state.windowKind });
  for (const group of result.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: result.state.windowKind });
}

function expectLuaRestoreStalePreapply(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const result = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Response is not currently legal");
  expect(result.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  assertLuaRestoreLegalWindow(restored, result, player);
}
