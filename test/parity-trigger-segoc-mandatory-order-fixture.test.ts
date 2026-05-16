import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  summonGroup,
  triggerActivationGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity SEGOC mandatory order fixture", () => {
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
            triggerTiming: "if",
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
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Opponent mandatory resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes initial open-priority summon actions before collecting mandatory SEGOC buckets",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { hand: ["100", "300"] },
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-mandatory" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-opponent-mandatory" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-turn-mandatory", "turnMandatory", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-opponent-mandatory", "opponentMandatory", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro places turn-player mandatory triggers before non-turn mandatory triggers during SEGOC",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 1, triggerBucket: "opponentMandatory" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 1, triggerBucket: "opponentMandatory" },
                actions: [{ type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-turn-mandatory" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player mandatory SEGOC bucket restorable while the opponent mandatory bucket waits behind it",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 1, triggerBucket: "opponentMandatory" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-turn-mandatory", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [triggerActivationGroup(0, "fixture-turn-mandatory", "turnMandatory", 1, 1)],
            absentLegalActions: [{ type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(1, "fixture-opponent-mandatory", "opponentMandatory", 1, "triggerBucket")],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes the non-turn mandatory bucket only after the turn-player mandatory bucket is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggers: [{ player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentMandatory" }],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
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
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        logIncludes: ["Turn mandatory resolved", "Opponent mandatory resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
