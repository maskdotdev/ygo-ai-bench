import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  summonGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

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
          { id: "fixture-opponent-optional", player: 1, code: "500", location: "hand", event: "trigger", triggerEvent: "normalSummoned", triggerTiming: "if", range: ["hand"], logMessage: "Fixture opponent optional resolved" },
          { id: "fixture-turn-optional", player: 0, code: "500", location: "hand", event: "trigger", triggerEvent: "normalSummoned", triggerTiming: "if", range: ["hand"], logMessage: "Fixture turn optional resolved" },
          { id: "fixture-opponent-mandatory", player: 1, code: "400", location: "hand", event: "trigger", triggerEvent: "normalSummoned", triggerTiming: "if", optional: false, range: ["hand"], logMessage: "Fixture opponent mandatory resolved" },
          { id: "fixture-turn-mandatory", player: 0, code: "300", location: "hand", event: "trigger", triggerEvent: "normalSummoned", triggerTiming: "if", optional: false, range: ["hand"], logMessage: "Fixture turn mandatory resolved" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes initial open-priority summon actions before collecting cross-player SEGOC buckets",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { hand: ["100", "300", "500"] },
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-mandatory" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-opponent-mandatory" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-optional" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-opponent-optional" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-turn-mandatory", "turnMandatory", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-opponent-mandatory", "opponentMandatory", 0, "open"),
              absentTriggerActivationGroup(0, "fixture-turn-optional", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-opponent-optional", "opponentOptional", 0, "open"),
            ],
          },
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
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 1, triggerBucket: "opponentMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                key: "1:triggerBucket:trigger-activate:turnMandatory:0",
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
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
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-mandatory" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player mandatory trigger bucket restorable before advancing to opponent mandatory triggers",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", triggerBucket: "turnMandatory", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-mandatory", eventName: "normalSummoned", triggerBucket: "opponentMandatory", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-turn-optional", eventName: "normalSummoned", triggerBucket: "turnOptional", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-optional", eventName: "normalSummoned", triggerBucket: "opponentOptional", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 1, triggerBucket: "opponentMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [triggerActivationGroup(0, "fixture-turn-mandatory", "turnMandatory", 1, 1)],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-opponent-mandatory", "opponentMandatory", 1, "triggerBucket"),
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory" }],
              },
            ],
          },
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
            pendingTriggerBuckets: [
              { player: 1, triggerBucket: "opponentMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                key: "2:triggerBucket:trigger-activate:opponentMandatory:1",
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "declineTrigger", player: 1, effectId: "fixture-opponent-mandatory" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentMandatory" },
                actions: [{ type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-opponent-mandatory" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent mandatory trigger bucket restorable before optional buckets can advance",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [],
            pendingTriggers: [
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [
              { player: 1, triggerBucket: "opponentMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            legalActionGroups: [triggerActivationGroup(1, "fixture-opponent-mandatory", "opponentMandatory", 1, 2)],
            absentLegalActions: [{ type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentMandatory" },
                actions: [{ type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
              },
            ],
          },
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
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
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
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 3,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, effectId: "fixture-opponent-optional" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Activations",
                windowId: 3,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentOptional" },
                actions: [{ type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-opponent-optional" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-turn-optional" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player optional trigger bucket restorable before opponent optional triggers can advance",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [
              { player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-turn-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-turn-optional", "turnOptional", 1, 3),
              triggerDeclineGroup(0, "fixture-turn-optional", "turnOptional", 1, 3),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(1, "fixture-opponent-optional", "opponentOptional", 3, "triggerBucket")],
          },
          after: {
            source: "edopro",
            note: "EDOPro presents opponent optional triggers only after the turn-player optional bucket is activated or declined",
            windowId: 4,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
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
                triggerBucket: { player: 1, triggerBucket: "opponentOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 }],
              },
              {
                player: 1,
                label: "Trigger Declines",
                windowId: 4,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-opponent-optional", triggerBucket: "opponentOptional", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, effectId: "fixture-turn-optional" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 4,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-turn-optional" }],
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
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        logIncludes: ["Fixture turn mandatory resolved", "Fixture opponent mandatory resolved", "fixture-turn-optional", "Fixture opponent optional resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("does not match trigger expectations from the wrong bucket", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "wrong trigger bucket expectation fixture",
      options: { seed: 48, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["100", "300"] },
      },
      setup: {
        effects: [
          { id: "fixture-turn-mandatory", player: 0, code: "300", location: "hand", event: "trigger", triggerEvent: "normalSummoned", triggerTiming: "if", optional: false, range: ["hand"], logMessage: "Fixture turn mandatory resolved" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          after: {
            source: "edopro",
            note: "EDOPro keeps mandatory turn-player triggers in the turn mandatory bucket, so this intentionally wrong optional-bucket expectation must fail",
            windowId: 1,
            windowKind: "triggerBucket",
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnOptional", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro would leave the wrong-bucket expectation unresolved and report the fixture mismatch",
        windowId: 1,
        windowKind: "triggerBucket",
        legalActionCounts: { 0: 1, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnOptional", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 1,
            windowKind: "triggerBucket",
            triggerBucket: { player: 0, triggerBucket: "turnOptional" },
            count: 1,
            actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnOptional", count: 1 }],
          },
        ],
      },
    };

    const result = runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) });

    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.message.includes("Expected legal action"))).toBe(true);
  });
});
