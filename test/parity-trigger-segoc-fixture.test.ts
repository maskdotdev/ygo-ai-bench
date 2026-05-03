import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity SEGOC trigger fixtures", () => {
  it("orders turn-player mandatory triggers before non-turn mandatory triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "turn player mandatory SEGOC fixture",
      options: { seed: 54, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-turn-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Turn mandatory resolved",
          },
          {
            id: "fixture-opponent-mandatory",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Opponent mandatory resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro places turn-player mandatory triggers before non-turn mandatory triggers during SEGOC",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            absentLegalActions: [{ type: "activateTrigger", player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-mandatory" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes the non-turn mandatory bucket only after the turn-player mandatory bucket is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            absentLegalActions: [{ type: "declineTrigger", player: 1, effectId: "fixture-opponent-mandatory" }],
            logIncludes: ["Turn mandatory resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-mandatory" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves turn-player mandatory triggers before non-turn mandatory triggers in SEGOC order",
        windowId: 3,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        logIncludes: ["Turn mandatory resolved", "Opponent mandatory resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("orders mandatory buckets before optional buckets for both players", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Optional", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Opponent Optional", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory optional SEGOC bucket fixture",
      options: { seed: 55, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "600", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-turn-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Turn mandatory resolved",
          },
          {
            id: "fixture-opponent-mandatory",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Opponent mandatory resolved",
          },
          {
            id: "fixture-turn-optional",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Turn optional resolved",
          },
          {
            id: "fixture-opponent-optional",
            player: 1,
            code: "600",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Opponent optional resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes only the turn-player mandatory SEGOC bucket before other mandatory or optional triggers",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" },
              { type: "activateTrigger", player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-mandatory" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes the non-turn mandatory bucket before either optional bucket",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            legalActionCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" },
            ],
            logIncludes: ["Turn mandatory resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-mandatory" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes turn-player optional triggers before non-turn optional triggers",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 0,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" }],
            logIncludes: ["Opponent mandatory resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-optional" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes non-turn optional triggers after turn-player optional triggers are handled",
            windowId: 4,
            windowKind: "triggerBucket",
            waitingFor: 1,
            legalActionCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 },
            ],
            logIncludes: ["Turn optional resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-optional" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves simultaneous triggers in turn mandatory, non-turn mandatory, turn optional, non-turn optional bucket order",
        windowId: 5,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        logIncludes: ["Turn mandatory resolved", "Opponent mandatory resolved", "Turn optional resolved", "Opponent optional resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
