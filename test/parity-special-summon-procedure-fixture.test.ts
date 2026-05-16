import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity special summon procedure fixtures", () => {
  it("opens inherent Special Summon procedure actions and resolves success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Special Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Special Summon Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon procedure success trigger fixture",
      options: { seed: 244, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-inherent-special-summon-procedure",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "fixture-special-success-watcher",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture special summon success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "fixture-inherent-special-summon-procedure" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes inherent Special Summon procedures as Main Phase legal actions before committing the summon attempt",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "specialSummonProcedure", player: 0, code: "100", location: "hand", effectId: "fixture-inherent-special-summon-procedure", windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "specialSummonProcedure", player: 0, code: "100", location: "hand", effectId: "fixture-inherent-special-summon-procedure", windowId: 0, windowKind: "open", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "normalSummon", player: 0, code: "200", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "setMonster", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "setMonster", player: 0, code: "200", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
                ],
              },
            ],
            locations: { hand: ["100", "200"] },
          },
          after: {
            source: "edopro",
            note: "EDOPro queues Special Summon success triggers after an inherent Special Summon completes without negation",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { monsterZone: ["100"], hand: ["200"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", faceUp: true }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-special-success-watcher", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-special-success-watcher", "turnOptional", 1, 1),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-special-success-watcher" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro queues Special Summon success triggers after an inherent Special Summon completes without negation",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { monsterZone: ["100"], hand: ["200"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", faceUp: true }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-special-success-watcher", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-special-success-watcher", "turnOptional", 1, 1),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the Special Summon success trigger after the procedure summon reaches the field",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, code: "200", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "setMonster", player: 0, code: "200", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            logIncludes: ["Fixture special summon success watcher resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the procedure monster Special Summoned after resolving success triggers",
        phase: "main1",
        windowId: 2,
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200"] },
        legalActionCounts: { 0: 4, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, code: "200", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "200", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        logIncludes: ["Fixture special summon success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
