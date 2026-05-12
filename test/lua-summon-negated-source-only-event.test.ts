import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelEventName, DuelSession } from "#duel/types.js";

describe("Lua source-only summon-negated events", () => {
  it("preserves active Lua reason source metadata for summon-negated triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reason Source Negated Summon", kind: "monster" },
      { code: "200", name: "Reason Source Summon Negator", kind: "monster" },
    ];
    const session = createDuel({ seed: 284, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local summoned=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 100), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          Debug.Message("reason negated " .. Duel.NegateSummon(summoned))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_NEGATED)
        e:SetRange(LOCATION_GRAVE)
        e:SetOperation(function(e,tp,eg)
          local negated=eg:GetFirst()
          local rc=negated:GetReasonCard()
          Debug.Message("negated reason source " .. tostring(rc and rc:IsCode(200)) .. "/" .. tostring(negated:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "summon-negated-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.code === "100");
    const negator = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(negator).toBeDefined();
    performSummon(session, "normal", source!.uid);
    activateNegator(session, negator!.uid);
    drainChain(session);

    expect(host.messages).toContain("reason negated 1");
    expect(source).toMatchObject({ location: "graveyard", reasonCardUid: negator!.uid, reasonEffectId: 2 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "normalSummonNegated", eventCardUid: source!.uid, eventReasonCardUid: negator!.uid, eventReasonEffectId: 2 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("negated reason source true/true");
  });

  it.each([
    { label: "normal", eventConstant: "EVENT_SUMMON_NEGATED", eventName: "normalSummonNegated" as DuelEventName, eventCode: 1114 },
    { label: "flip", eventConstant: "EVENT_FLIP_SUMMON_NEGATED", eventName: "flipSummonNegated" as DuelEventName, eventCode: 1115 },
    { label: "special", eventConstant: "EVENT_SPSUMMON_NEGATED", eventName: "specialSummonNegated" as DuelEventName, eventCode: 1116 },
  ])("binds $eventConstant single triggers only to the negated source card", ({ label, eventConstant, eventName, eventCode }) => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Negated Summon", kind: "monster" },
      { code: "200", name: "Summon Negator", kind: "monster" },
      { code: "300", name: "Negated Summon Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Negated Summon Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 125 + eventCode, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c100.lua") return `
      c100={}
      function c100.initial_effect(c)
      local source_trigger=Effect.CreateEffect(c)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(${eventConstant})
      source_trigger:SetRange(LOCATION_GRAVE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source ${label} negated " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(source_trigger)
      end
      `;
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local negate=Effect.CreateEffect(c)
      negate:SetType(EFFECT_TYPE_IGNITION)
      negate:SetRange(LOCATION_HAND)
      negate:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
        Debug.Message("negated " .. Duel.NegateSummon(g:GetFirst()))
      end)
      c:RegisterEffect(negate)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local generic_trigger=Effect.CreateEffect(c)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(${eventConstant})
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic ${label} negated " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(generic_trigger)
      end
      `;
        if (name === "c301.lua") return `
      c301={}
      function c301.initial_effect(c)
      local wrong_single=Effect.CreateEffect(c)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(${eventConstant})
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong ${label} negated " .. eg:GetCount())
      end)
      c:RegisterEffect(wrong_single)
      end
      `;
        return undefined;
      },
    };
    for (const code of [100, 200, 300, 301]) {
      const loaded = host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.code === "100");
    const negator = session.state.cards.find((card) => card.code === "200");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(source).toBeDefined();
    expect(negator).toBeDefined();

    performSummon(session, label, source!.uid);
    activateNegator(session, negator!.uid);
    drainChain(session);

    expect(host.messages).toContain("negated 1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "graveyard" });
    const negatedTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
    expect(negatedTriggers).toHaveLength(2);
    expect(negatedTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode }),
      ]),
    );
    expect(negatedTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredNegatedTriggers = restored.session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
    expect(restoredNegatedTriggers).toHaveLength(2);
    expect(restoredNegatedTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode }),
      ]),
    );
    expect(restoredNegatedTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining([`source ${label} negated 1/100`, `generic ${label} negated 1/100`]));
    expect(restored.host.messages).not.toContain(`wrong ${label} negated 1`);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining([`source ${label} negated 1/100`, `generic ${label} negated 1/100`]));
    expect(host.messages).not.toContain(`wrong ${label} negated 1`);
  });
});

function performSummon(session: DuelSession, label: string, sourceUid: string): void {
  if (label === "normal") {
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === sourceUid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    return;
  }
  if (label === "flip") {
    const source = session.state.cards.find((card) => card.uid === sourceUid)!;
    moveDuelCard(session.state, sourceUid, "monsterZone", 0).position = "faceDownDefense";
    source.faceUp = false;
    const flip = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === sourceUid);
    expect(flip).toBeDefined();
    applyAndAssert(session, flip!);
    return;
  }
  specialSummonDuelCard(session.state, sourceUid, 0);
}

function activateNegator(session: DuelSession, negatorUid: string): void {
  const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === negatorUid);
  expect(action).toBeDefined();
  applyAndAssert(session, action!);
}

function drainChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function activateAllTriggers(session: DuelSession): void {
  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
}

function activateAllRestoredTriggers(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (;;) {
    const player = restored.session.state.waitingFor ?? 0;
    const trigger = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyLuaRestoreAndAssert(restored, trigger);
  }
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
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
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(queryPublicState(restored.session)).toEqual(response.state);
  return response;
}
