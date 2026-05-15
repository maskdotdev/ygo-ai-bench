import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, type LuaSnapshotRestoreResult, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua summon-negated events", () => {
  it("removes matching summon-success triggers when an attempt trigger negates the summon", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attempt-Negated Summon", kind: "monster" },
      { code: "200", name: "Attempt Negator", kind: "monster" },
      { code: "300", name: "Success Watcher", kind: "monster" },
      { code: "400", name: "Negated Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 201, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const scriptSource = {
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
          Debug.Message("attempt negate " .. Duel.NegateSummon(eg:GetFirst()))
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
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("success should not resolve " .. eg:GetFirst():GetCode())
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
        e:SetCode(EVENT_SUMMON_NEGATED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("negated after attempt " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    for (const code of [200, 300, 400]) {
      const loaded = host.loadCardScript(code, scriptSource);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const summoned = session.state.cards.find((card) => card.code === "100");
    expect(summoned).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummoning", "normalSummoned"]);
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ eventName: "normalSummoning", eventCode: 1103, eventCardUid: summoned!.uid }),
      expect.objectContaining({ eventName: "normalSummoned", eventCode: 1100, eventCardUid: summoned!.uid }),
    ]);

    const attemptNegator = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid.includes("200"));
    expect(attemptNegator).toBeDefined();
    applyAndAssert(session, attemptNegator!);
    drainChain(session);

    expect(host.messages).toContain("attempt negate 1");
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummonNegated"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "normalSummonNegated", eventCode: 1114, eventCardUid: summoned!.uid });
    expect(session.state.eventHistory.map((event) => event.eventName)).not.toContain("normalSummoned");
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateTrigger" && candidate.uid.includes("300"))).toBe(false);
    const originalNegatedTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid.includes("400"));
    expect(originalNegatedTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), scriptSource, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.eventHistory.map((event) => event.eventName)).not.toContain("normalSummoned");
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "activateTrigger" && candidate.uid.includes("300"))).toBe(false);

    const negatedTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid.includes("400"));
    expect(negatedTrigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, negatedTrigger!, 0);
    const originalNegatedTriggerPreapply = applyLuaRestoreResponse(restored, originalNegatedTrigger!);
    expect(originalNegatedTriggerPreapply.ok).toBe(false);
    expect(originalNegatedTriggerPreapply.error).toContain("Response is not currently legal");
    assertPublicRestoreMetadata(restored, originalNegatedTriggerPreapply);
    expect(originalNegatedTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    applyLuaRestoreAndAssert(restored, negatedTrigger!);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("negated after attempt 100");
    expect(restored.host.messages.some((message) => message.startsWith("success should not resolve"))).toBe(false);
  });

  it("queues summon-negated triggers when Duel.NegateSummon negates a Normal Summon", () => {
    const fixture = createNegatedSummonFixture(198, "EVENT_SUMMON_NEGATED", "normal summon negated");
    const summon = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === fixture.summoned.uid);
    expect(summon).toBeDefined();
    applyAndAssert(fixture.session, summon!);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid, eventCode: 1114 });
    const originalTrigger = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();
    assertRestoredNegatedTrigger(fixture, "normal summon negated 100", originalTrigger!);
  });

  it("queues flip-summon-negated triggers when Duel.NegateSummon negates a Flip Summon", () => {
    const fixture = createNegatedSummonFixture(199, "EVENT_FLIP_SUMMON_NEGATED", "flip summon negated");
    moveDuelCard(fixture.session.state, fixture.summoned.uid, "monsterZone", 0).position = "faceDownDefense";
    fixture.summoned.faceUp = false;
    const flip = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === fixture.summoned.uid);
    expect(flip).toBeDefined();
    applyAndAssert(fixture.session, flip!);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid, eventCode: 1115 });
    const originalTrigger = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();
    assertRestoredNegatedTrigger(fixture, "flip summon negated 100", originalTrigger!);
  });

  it("queues special-summon-negated triggers when Duel.NegateSummon negates a Special Summon", () => {
    const fixture = createNegatedSummonFixture(197, "EVENT_SPSUMMON_NEGATED", "special summon negated");
    specialSummonDuelCard(fixture.session.state, fixture.summoned.uid, 0);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid, eventCode: 1116 });
    expect(fixture.session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["specialSummonNegated", "chainSolved"]);
    const originalTrigger = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();
    assertRestoredNegatedTrigger(fixture, "special summon negated 100", originalTrigger!);
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

interface NegatedSummonFixture {
  cards: DuelCardData[];
  host: ReturnType<typeof createLuaScriptHost>;
  scriptSource: { readScript(name: string): string | undefined };
  session: ReturnType<typeof createDuel>;
  summoned: NonNullable<ReturnType<ReturnType<typeof createDuel>["state"]["cards"]["find"]>>;
}

function createNegatedSummonFixture(seed: number, eventCode: string, message: string): NegatedSummonFixture {
  const cards: DuelCardData[] = [
    { code: "100", name: "Negated Summon", kind: "monster" },
    { code: "200", name: "Summon Negator", kind: "monster" },
    { code: "300", name: "Negation Watcher", kind: "monster" },
  ];
  const session = createDuel({ seed, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200", "300"] },
    1: { main: [] },
  });
  startDuel(session);
  const summoned = session.state.cards.find((card) => card.code === "100");
  expect(summoned).toBeDefined();

  const scriptSource = {
    readScript(name: string) {
      if (name === "c200.lua") {
        return `
    c200={}
    function c200.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
        Debug.Message("negated count " .. Duel.NegateSummon(g:GetFirst()))
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
      e:SetCode(${eventCode})
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("${message} " .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(e)
    end
    `;
      }
      return undefined;
    },
  };
  const host = createLuaScriptHost(session);
  const negatorScript = host.loadCardScript(200, scriptSource);
  const watcherScript = host.loadCardScript(300, scriptSource);
  expect(negatorScript.ok, negatorScript.error).toBe(true);
  expect(watcherScript.ok, watcherScript.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { cards, host, scriptSource, session, summoned: summoned! };
}

function activateNegator(fixture: { session: ReturnType<typeof createDuel> }): void {
  const action = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("200"));
  expect(action).toBeDefined();
  applyAndAssert(fixture.session, action!);
}

function assertRestoredNegatedTrigger(fixture: NegatedSummonFixture, message: string, originalTrigger: Parameters<typeof applyLuaRestoreResponse>[1]): void {
  const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.scriptSource, createCardReader(fixture.cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expectRestoredLegalActions(restored, 0);
  expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c200.lua", "c300.lua"]);
  expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
  expect(restored.session.state.pendingTriggers).toEqual(fixture.session.state.pendingTriggers);
  expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(fixture.session).pendingTriggerBuckets);
  expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(fixture.session).triggerOrderPrompt);
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  const publicState = queryPublicState(restored.session);
  expect(trigger).toMatchObject({ windowId: publicState.actionWindowId, windowKind: "triggerBucket" });
  expectLuaRestoreStalePreapply(restored, trigger!, 0);
  const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger);
  expect(originalTriggerPreapply.ok).toBe(false);
  expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
  assertPublicRestoreMetadata(restored, originalTriggerPreapply);
  expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
  applyLuaRestoreAndAssert(restored, trigger!);
  const staleResult = applyLuaRestoreResponse(restored, trigger!);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  assertPublicRestoreMetadata(restored, staleResult);
  expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored.session, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
  drainRestoredChain(restored);
  expect(restored.host.messages).toContain(message);
}

function drainRestoredChain(restored: LuaSnapshotRestoreResult): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expectLuaRestoreStalePreapply(restored, pass!, player);
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function expectLuaRestoreStalePreapply(restored: LuaSnapshotRestoreResult, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const result = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Response is not currently legal");
  expect(result.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  assertPublicRestoreMetadata(restored, result);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function applyLuaRestoreAndAssert(restored: LuaSnapshotRestoreResult, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  assertPublicRestoreMetadata(restored, result);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function assertPublicRestoreMetadata(restored: LuaSnapshotRestoreResult, result: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(result.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(result.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(result.state).not.toHaveProperty("triggerOrderPrompt");
  }
}
