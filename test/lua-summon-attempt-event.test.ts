import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon-attempt events", () => {
  it("queues normal-summon attempt triggers before normal-summon success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Source", kind: "monster" },
      { code: "200", name: "Normal Attempt Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 192, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("normal attempt " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "normal-summon-attempt.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const summoned = session.state.cards.find((card) => card.code === "100");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: summoned!.uid });
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["normalSummoning", "normalSummoned"]);
  });

  it("queues special-summon attempt triggers before special-summon success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Special Summon Source", kind: "monster" },
      { code: "200", name: "Special Attempt Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 193, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SPSUMMON)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("special attempt " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "special-summon-attempt.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    specialSummonDuelCard(session.state, source!.uid, 0);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: source!.uid });
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["specialSummoning", "specialSummoned"]);
  });

  it("queues flip-summon attempt triggers before flip-summon success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Flip Summon Source", kind: "monster" },
      { code: "200", name: "Flip Attempt Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 194, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceDownDefense";
    source!.faceUp = false;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_FLIP_SUMMON)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("flip attempt " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "flip-summon-attempt.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: source!.uid });
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["flipSummoning", "flipSummoned"]);
  });
});
