import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua draw grouped events", () => {
  it("collects one grouped EVENT_DRAW success event for multi-card draws", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Drawn First", kind: "monster" },
      { code: "201", name: "Drawn Second", kind: "monster" },
      { code: "300", name: "Draw Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);
    const expectedDrawnUids = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, 2)
      .map((card) => card.uid);

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local first_trigger=Effect.CreateEffect(c)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DRAW)
      first_trigger:SetRange(LOCATION_HAND)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("draw first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DRAW)
      second_trigger:SetRange(LOCATION_HAND)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("draw second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local draw=Effect.CreateEffect(c)
      draw:SetType(EFFECT_TYPE_IGNITION)
      draw:SetRange(LOCATION_HAND)
      draw:SetOperation(function(e,tp)
        Debug.Message("draw grouped " .. Duel.Draw(tp, 2, REASON_EFFECT))
      end)
      c:RegisterEffect(draw)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_DRAW)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("draw generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
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

    const drawAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(drawAction).toBeDefined();
    applyAndAssert(session, drawAction!);

    const first = session.state.cards.find((card) => card.uid === expectedDrawnUids[0]);
    const second = session.state.cards.find((card) => card.uid === expectedDrawnUids[1]);
    expect(host.messages).toContain("draw grouped 2");
    expect(first).toMatchObject({ location: "hand" });
    expect(second).toMatchObject({ location: "hand" });
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedDrawnUids);
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
    for (const trigger of restored.session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedDrawnUids);
    expect(restored.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["draw first group 2", "draw second group 2", "draw generic group 2/2"]));

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["draw first group 2", "draw second group 2", "draw generic group 2/2"]));
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
