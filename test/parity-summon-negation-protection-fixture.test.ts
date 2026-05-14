import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity summon negation protection fixtures", () => {
  it("keeps protected summon-success triggers when summon negation is prevented", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Normal Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Blocked Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Protected Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon negation protection keeps success trigger fixture",
      options: { seed: 231, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cannot-disable-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 26,
            range: ["monsterZone"],
          },
          {
            id: "fixture-blocked-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture blocked summon negator resolved",
          },
          {
            id: "fixture-protected-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Fixture protected summon-success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes protected Normal Summon choices before committing the summon attempt and collecting summon-negation triggers",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro still opens summon-negation response timing for Normal Summons protected by EFFECT_CANNOT_DISABLE_SUMMON",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-summon-negator", eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-blocked-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-blocked-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-blocked-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-blocked-summon-negator", "turnOptional", 1, 1),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-blocked-summon-negator" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the protected Normal Summon negation trigger-order prompt restorable before selecting the blocked negation response",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-summon-negator", eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-blocked-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-blocked-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-blocked-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-blocked-summon-negator", "turnOptional", 1, 1),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the Normal Summon success trigger when EFFECT_CANNOT_DISABLE_SUMMON prevents summon negation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-protected-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-protected-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-protected-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-protected-success-watcher", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-protected-success-watcher", "turnOptional", 1, 2),
            ],
            logIncludes: ["Fixture blocked summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-protected-success-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the protected Normal Summon success trigger after blocked summon negation",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200", "300"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        logIncludes: ["Fixture protected summon-success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
