import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua Release grouped events", () => {
  it("collects one grouped EVENT_RELEASE success event for direct group releases", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Release First", kind: "monster" },
      { code: "201", name: "Grouped Release Second", kind: "monster" },
      { code: "300", name: "Grouped Release Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 102, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local first_trigger=Effect.CreateEffect(c)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_RELEASE)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("release first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_RELEASE)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("release second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local release=Effect.CreateEffect(c)
      release:SetType(EFFECT_TYPE_IGNITION)
      release:SetRange(LOCATION_HAND)
      release:SetOperation(function(e,tp)
        local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
        local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
        Debug.Message("release grouped " .. Duel.Release(Group.FromCards(first, second), REASON_EFFECT))
      end)
      c:RegisterEffect(release)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_RELEASE)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("release generic group " .. eg:GetCount())
      end)
      c:RegisterEffect(generic)
      end
      `;
        return undefined;
      },
    };
    for (const code of [200, 201, 300]) {
      const loaded = host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const watcher = session.state.cards.find((card) => card.code === "300");
    const releaseAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(releaseAction).toBeDefined();
    applyAndAssert(session, releaseAction!);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    expect(host.messages).toContain("release grouped 2");
    expect(first).toMatchObject({ location: "graveyard" });
    expect(second).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    expect(restored.session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of restored.session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(restored.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["release first group 2", "release second group 2", "release generic group 2"]));

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["release first group 2", "release second group 2", "release generic group 2"]));
  });

  it("preserves active Lua reason source metadata for release triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Source", kind: "monster" },
      { code: "200", name: "Reason Release Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 103, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["100", "200"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          source_effect=e
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode,200), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("reason release count " .. Duel.Release(target, REASON_EFFECT))
          local tc=target:GetFirst()
          Debug.Message("release reason source " .. tostring(tc:GetReasonCard()==c) .. "/" .. tostring(tc:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RELEASE)
        e:SetRange(LOCATION_GRAVE)
        e:SetOperation(function(e,tp,eg)
          local c=e:GetHandler()
          local rc=c:GetReasonCard()
          local re=c:GetReasonEffect()
          Debug.Message("release event reason source " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(re==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "release-reason-source-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(host.messages).toContain("reason release count 1");
    expect(host.messages).toContain("release reason source true/true");
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "released", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("release event reason source true/true");
  });
});

function activateAllTriggers(session: ReturnType<typeof createDuel>): void {
  for (;;) {
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
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
