import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

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
          snapshotRestore: "both",
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
          after: {
            source: "edopro",
            note: "EDOPro exposes the non-turn mandatory bucket only after the turn-player mandatory bucket is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-turn-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 1, effectId: "fixture-opponent-mandatory", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
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

  it("returns opponent optional declines to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After SEGOC", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent optional decline open fast SEGOC fixture",
      options: { seed: 55, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-optional-decline",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC turn optional should not resolve",
          },
          {
            id: "fixture-segoc-opponent-optional-decline",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC opponent optional should not resolve",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-decline",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent decline resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro presents turn-player optional triggers before non-turn optional triggers during SEGOC",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 0, effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-segoc-turn-optional-decline" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro hands SEGOC optional priority to the non-turn optional bucket after the turn optional bucket is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-decline" }],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-segoc-opponent-optional-decline" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns to turn-player open fast-effect priority after the non-turn optional bucket is declined",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            logIncludes: ["fixture-segoc-turn-optional-decline", "fixture-segoc-opponent-optional-decline"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state offers turn-player open fast effects after both optional SEGOC buckets are declined",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
          },
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
        ],
        logIncludes: ["fixture-segoc-turn-optional-decline", "fixture-segoc-opponent-optional-decline"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
