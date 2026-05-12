import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua GetControl grouped events", () => {
  it("preserves active Lua reason source metadata for controlled cards and grouped control events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Control Reason Target", kind: "monster", typeFlags: 0x21 },
      { code: "201", name: "Control Reason Second Target", kind: "monster", typeFlags: 0x21 },
      { code: "700", name: "Control Reason Watcher", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "700"] }, 1: { main: ["200", "201"] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    expect(source).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    for (const card of [first!, second!]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
      card.position = "faceUpAttack";
      card.faceUp = true;
    }

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
          local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
          local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
          Debug.Message("control reason result " .. Duel.GetControl(Group.FromCards(first, second), tp, 0, 0, LOCATION_MZONE))
          Debug.Message("control reason first " .. tostring(first:GetReasonCard()==c) .. "/" .. tostring(first:GetReasonEffect()==source_effect))
          Debug.Message("control reason second " .. tostring(second:GetReasonCard()==c) .. "/" .. tostring(second:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c700={}
      function c700.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CONTROL_CHANGED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local changed=eg:GetFirst()
          Debug.Message("control event reason source " .. tostring(changed:GetReasonCard():IsCode(100)) .. "/" .. tostring(changed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "get-control-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(expect.arrayContaining(["control reason result 2", "control reason first true/true", "control reason second true/true"]));
    expect(first).toMatchObject({ controller: 0, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(second).toMatchObject({ controller: 0, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "controlChanged", eventCardUid: first!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("control event reason source true/true");
  });

  it("collects one grouped EVENT_CONTROL_CHANGED event for direct group control changes", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Control First", kind: "monster" },
      { code: "201", name: "Grouped Control Second", kind: "monster" },
      { code: "300", name: "Grouped Control Watcher", kind: "monster" },
      { code: "301", name: "Grouped Control Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["300", "301"] }, 1: { main: ["200", "201"] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 1);
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
      first_trigger:SetCode(EVENT_CONTROL_CHANGED)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("control first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_CONTROL_CHANGED)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("control second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local control=Effect.CreateEffect(c)
      control:SetType(EFFECT_TYPE_IGNITION)
      control:SetRange(LOCATION_HAND)
      control:SetOperation(function(e,tp)
        local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
        local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
        Debug.Message("control grouped " .. Duel.GetControl(Group.FromCards(first, second), tp, 0, 0, LOCATION_MZONE))
      end)
      c:RegisterEffect(control)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_CONTROL_CHANGED)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("control generic group " .. eg:GetCount())
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
    const controlAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(controlAction).toBeDefined();
    applyAndAssert(session, controlAction!);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    expect(host.messages).toContain("control grouped 2");
    expect(first).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(second).toMatchObject({ controller: 0, location: "monsterZone" });
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
    expect(restored.host.messages).toEqual(expect.arrayContaining(["control first group 2", "control second group 2", "control generic group 2"]));

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["control first group 2", "control second group 2", "control generic group 2"]));
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
