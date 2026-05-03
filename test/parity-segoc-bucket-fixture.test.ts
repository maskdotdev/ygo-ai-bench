import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity SEGOC bucket fixtures", () => {
  it("orders cross-player mandatory and optional trigger buckets", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Optional Trigger", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "segoc trigger bucket fixture",
      options: { seed: 47, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "500", "300"] },
      },
      setup: {
        effects: [
          { id: "fixture-opponent-optional", player: 1, code: "500", location: "hand", event: "trigger", triggerEvent: "normalSummoned", range: ["hand"], logMessage: "Fixture opponent optional resolved" },
          { id: "fixture-turn-optional", player: 0, code: "500", location: "hand", event: "trigger", triggerEvent: "normalSummoned", range: ["hand"], logMessage: "Fixture turn optional resolved" },
          { id: "fixture-opponent-mandatory", player: 1, code: "400", location: "hand", event: "trigger", triggerEvent: "normalSummoned", optional: false, range: ["hand"], logMessage: "Fixture opponent mandatory resolved" },
          { id: "fixture-turn-mandatory", player: 0, code: "300", location: "hand", event: "trigger", triggerEvent: "normalSummoned", optional: false, range: ["hand"], logMessage: "Fixture turn mandatory resolved" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          after: {
            source: "edopro",
            note: "EDOPro SEGOC collects turn mandatory, opponent mandatory, turn optional, then opponent optional trigger buckets",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", triggerBucket: "turnMandatory", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-mandatory", eventName: "normalSummoned", triggerBucket: "opponentMandatory", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-turn-optional", eventName: "normalSummoned", triggerBucket: "turnOptional", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-optional", eventName: "normalSummoned", triggerBucket: "opponentOptional", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                key: "1:triggerBucket:trigger-activate",
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, effectId: "fixture-opponent-mandatory" },
              { type: "declineTrigger", player: 0, effectId: "fixture-turn-mandatory" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-mandatory" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro passes priority to the opponent mandatory bucket after the turn player's mandatory trigger is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" },
              { player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional" },
              { player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                key: "2:triggerBucket:trigger-activate",
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "declineTrigger", player: 1, effectId: "fixture-opponent-mandatory" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                actions: [{ type: "declineTrigger", player: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-mandatory" }), {
          after: {
            source: "edopro",
            note: "EDOPro presents turn-player optional triggers before opponent optional triggers after mandatory buckets are consumed",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional" },
              { player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 3,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 3,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, effectId: "fixture-opponent-optional" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Activations",
                windowId: 3,
                windowKind: "triggerBucket",
                actions: [{ type: "activateTrigger", player: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-optional" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-turn-optional" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro presents opponent optional triggers only after the turn-player optional bucket is activated or declined",
            windowId: 4,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Trigger Activations",
                windowId: 4,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 }],
              },
              {
                player: 1,
                label: "Trigger Declines",
                windowId: 4,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, effectId: "fixture-turn-optional" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 4,
                windowKind: "triggerBucket",
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-turn-optional" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-optional" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves all SEGOC buckets in mandatory-then-optional player order",
        windowId: 5,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        prompt: null,
        locationCounts: { monsterZone: { "100": 1 }, hand: { "300": 2, "400": 1, "500": 2 } },
        logIncludes: ["Fixture turn mandatory resolved", "Fixture opponent mandatory resolved", "fixture-turn-optional", "Fixture opponent optional resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
