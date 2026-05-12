import { describe, expect, it } from "vitest";
import { addDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua counter remove grouped events", () => {
  it("collects one grouped EVENT_REMOVE_COUNTER success event for field counter removal", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Counter Holder First", kind: "monster" },
      { code: "201", name: "Counter Holder Second", kind: "monster" },
      { code: "300", name: "Counter Remove Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 126, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
      expect(addDuelCardCounter(card!, 99, 1)).toBe(true);
    }

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local first_trigger=Effect.CreateEffect(c)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_REMOVE_COUNTER)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("counter first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_REMOVE_COUNTER)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("counter second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local remove=Effect.CreateEffect(c)
      remove:SetType(EFFECT_TYPE_IGNITION)
      remove:SetRange(LOCATION_HAND)
      remove:SetOperation(function(e,tp)
        Debug.Message("counter removed " .. Duel.RemoveCounter(tp, LOCATION_MZONE, 0, 99, 2, REASON_EFFECT))
      end)
      c:RegisterEffect(remove)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_REMOVE_COUNTER)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("counter generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
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
    const removeAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(removeAction).toBeDefined();
    applyAndAssert(session, removeAction!);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const expectedUids = [first!.uid, second!.uid];
    expect(host.messages).toContain("counter removed 2");
    expect(first!.counters?.[99]).toBeUndefined();
    expect(second!.counters?.[99]).toBeUndefined();
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedUids);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of restored.session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedUids);
    expect(restored.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["counter first group 2", "counter second group 2", "counter generic group 2/2"]));

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["counter first group 2", "counter second group 2", "counter generic group 2/2"]));
  });
});

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
