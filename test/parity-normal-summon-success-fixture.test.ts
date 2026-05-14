import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup, summonGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Normal Summon success fixtures", () => {
  it("opens Normal Summon actions and resolves success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Candidate", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Normal Summon Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon success trigger fixture",
      options: { seed: 245, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-normal-success-watcher",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Fixture normal summon success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes eligible Normal Summons as Main Phase legal actions before committing the summon attempt",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
              ], 1, 0),
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
            note: "EDOPro queues Normal Summon success triggers after an un-negated Normal Summon reaches the field",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-normal-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["100"], hand: ["200"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", faceUp: true }],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-normal-success-watcher" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro queues Normal Summon success triggers after an un-negated Normal Summon reaches the field",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-normal-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["100"], hand: ["200"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", faceUp: true }],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the Normal Summon success trigger after the summoned monster reaches the field",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            logIncludes: ["Fixture normal summon success watcher resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the Normal Summoned monster on the field after resolving success triggers",
        phase: "main1",
        windowId: 2,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], hand: ["200"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        logIncludes: ["Fixture normal summon success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
