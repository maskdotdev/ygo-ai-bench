import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua state event helpers", () => {
  it("lets Lua scripts raise events for trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Raised Event Card", kind: "monster" },
      { code: "200", name: "Raised Event Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 143, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("raised trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "raise-event-register.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      `,
      "raise-event.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: session.state.cards.find((card) => card.code === "100")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("raised trigger 100");
  });

  it("lets Lua scripts raise single-card events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Single Event First", kind: "monster" },
      { code: "101", name: "Single Event Second", kind: "monster" },
      { code: "200", name: "Single Event Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 146, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("single trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "raise-single-event-register.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 101), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseSingleEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("single check " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "raise-single-event.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const raisedUid = session.state.cards.find((card) => card.code === "101")?.uid;
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: raisedUid })]));
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: raisedUid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("single check true");
    expect(host.messages).toContain("single trigger 101");
  });

  it("lets Lua scripts check recorded duel events", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Checked Event Card", kind: "monster" }];
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("check before " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("check raised " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-raised.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check before false");
    expect(host.messages).toContain("check raised true");
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: session.state.cards.find((card) => card.code === "100")?.uid })]),
    );

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredResult = restoredHost.loadScript(
      `
      Debug.Message("check restored " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-restored.lua",
    );

    expect(restoredResult.ok, restoredResult.error).toBe(true);
    expect(restoredHost.messages).toContain("check restored true");
  });

  it("records engine movement events for Lua event checks", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Moved Event Card", kind: "monster" }];
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.SendtoGrave(target, REASON_EFFECT)
      Debug.Message("check moved " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-moved.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check moved true");
  });

  it("lets Lua scripts query a card's summon player", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Player Normal", kind: "monster" },
      { code: "200", name: "Summon Player Special", kind: "monster" },
      { code: "300", name: "Summon Player Unsummoned", kind: "monster" },
    ];
    const session = createDuel({ seed: 147, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const normal = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const special = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    const unsummoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(normal).toBeTruthy();
    expect(special).toBeTruthy();
    expect(unsummoned).toBeTruthy();

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon player unsummoned " .. tostring(c:IsSummonPlayer(0)) .. "/" .. tostring(c:IsSummonPlayer(1)))
      `,
      "summon-player-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("summon player unsummoned false/false");

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normal!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    specialSummonDuelCard(session.state, special!.uid, 1);

    const after = host.loadScript(
      `
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local special=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon player normal " .. tostring(normal:IsSummonPlayer(0)) .. "/" .. tostring(normal:IsSummonPlayer(1)))
      Debug.Message("summon player special " .. tostring(special:IsSummonPlayer(0)) .. "/" .. tostring(special:IsSummonPlayer(1)))
      `,
      "summon-player-after.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === normal!.uid)?.summonPlayer).toBe(0);
    expect(session.state.cards.find((card) => card.uid === special!.uid)?.summonPlayer).toBe(1);
    expect(host.messages).toContain("summon player normal true/false");
    expect(host.messages).toContain("summon player special false/true");
  });

});
