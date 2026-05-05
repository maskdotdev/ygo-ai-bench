import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, type LuaSnapshotRestoreResult, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

    const sourceScript = {
      readScript(name: string) {
        if (name === "c200.lua") {
          return `
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
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(200, sourceScript);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const summoned = session.state.cards.find((card) => card.code === "100");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: summoned!.uid, eventCode: 1103 });
    expect(session.state.eventHistory.slice(-2)).toEqual([
      expect.objectContaining({ eventName: "normalSummoning", eventCode: 1103 }),
      expect.objectContaining({ eventName: "normalSummoned", eventCode: 1100 }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c200.lua" }]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertRestoredAttemptTrigger(restored);
    expect(restored.host.messages).toContain("normal attempt 100");
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

    const sourceScript = {
      readScript(name: string) {
        if (name === "c200.lua") {
          return `
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
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(200, sourceScript);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const sourceCard = session.state.cards.find((card) => card.code === "100");
    expect(sourceCard).toBeDefined();
    specialSummonDuelCard(session.state, sourceCard!.uid, 0);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: sourceCard!.uid, eventCode: 1105 });
    expect(session.state.eventHistory.slice(-2)).toEqual([
      expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105 }),
      expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102 }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c200.lua" }]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertRestoredAttemptTrigger(restored);
    expect(restored.host.messages).toContain("special attempt 100");
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

    const sourceScript = {
      readScript(name: string) {
        if (name === "c200.lua") {
          return `
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
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(200, sourceScript);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoning"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: source!.uid, eventCode: 1104 });
    expect(session.state.eventHistory.slice(-2)).toEqual([
      expect.objectContaining({ eventName: "flipSummoning", eventCode: 1104 }),
      expect.objectContaining({ eventName: "flipSummoned", eventCode: 1101 }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c200.lua" }]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertRestoredAttemptTrigger(restored);
    expect(restored.host.messages).toContain("flip attempt 100");
  });
});

function assertRestoredAttemptTrigger(restored: LuaSnapshotRestoreResult): void {
  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  const publicState = queryPublicState(restored.session);
  expect(trigger).toMatchObject({ windowId: publicState.actionWindowId, windowKind: "triggerBucket" });
  const result = applyLuaRestoreResponse(restored, trigger!);
  expect(result.ok).toBe(true);
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  const staleResult = applyLuaRestoreResponse(restored, trigger!);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.session.state.actionWindowId);
}
