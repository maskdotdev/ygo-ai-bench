import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

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
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 0, effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 1, "triggerBucket"),
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
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-decline" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 2, "triggerBucket")],
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
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-decline", 3, "open"),
            ],
            logIncludes: ["fixture-segoc-turn-optional-decline", "fixture-segoc-opponent-optional-decline"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-decline" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after both SEGOC optional buckets are declined",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-decline" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent decline resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the post-SEGOC open fast effect resolves",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-decline" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-decline" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent decline resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("returns opponent optional activations directly to open fast-effect priority when no chain response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After SEGOC", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent optional activation open fast SEGOC fixture",
      options: { seed: 56, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-optional-before-opponent-activation",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC turn optional before opponent activation should not resolve",
          },
          {
            id: "fixture-segoc-opponent-optional-activation",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC opponent optional activation resolved",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-activation",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent activation resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-segoc-turn-optional-before-opponent-activation" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro hands SEGOC optional priority to the non-turn optional bucket after the turn optional bucket is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-activation" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-activation", 2, "triggerBucket")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-optional-activation" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the opponent optional trigger immediately when no legal chain response exists",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-activation", 3, "open"),
            ],
            logIncludes: ["fixture-segoc-turn-optional-before-opponent-activation", "SEGOC opponent optional activation resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-activation" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after an unresponded opponent optional SEGOC trigger",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-before-opponent-activation" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent activation resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after resolving the post-SEGOC activation open fast effect",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-before-opponent-activation" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-activation" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent activation resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("opens chain responses for opponent optional activations when a response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Chain Quick After SEGOC", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent optional activation chain response SEGOC fixture",
      options: { seed: 57, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-optional-before-opponent-chain",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC turn optional before opponent chain should not resolve",
          },
          {
            id: "fixture-segoc-opponent-optional-chain",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "SEGOC opponent optional chain resolved",
          },
          {
            id: "fixture-segoc-turn-chain-response",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "SEGOC turn chain response resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-segoc-turn-optional-before-opponent-chain" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-optional-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens turn-player chain-response priority after an opponent optional trigger when a chain response exists",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 1, effectId: "fixture-segoc-opponent-optional-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-segoc-turn-chain-response", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-segoc-turn-chain-response", 1, 3), chainPassGroup(0, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-turn-chain-response" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the opponent optional trigger chain after the turn player adds the only legal response",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(4)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-chain-response" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-segoc-turn-chain-response", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-chain", "opponentOptional", 4, "triggerBucket"),
            ],
            logIncludes: ["SEGOC turn chain response resolved", "SEGOC opponent optional chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves opponent optional trigger chains after the only turn-player chain response",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-chain-response" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-segoc-turn-chain-response", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-chain", "opponentOptional", 4, "triggerBucket"),
        ],
        logIncludes: ["SEGOC turn chain response resolved", "SEGOC opponent optional chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("opens chain responses for opponent mandatory activations when a response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Chain Quick After Mandatory", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent mandatory activation chain response SEGOC fixture",
      options: { seed: 58, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-mandatory-before-opponent-chain",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC turn mandatory before opponent chain resolved",
          },
          {
            id: "fixture-segoc-opponent-mandatory-chain",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC opponent mandatory chain resolved",
          },
          {
            id: "fixture-segoc-turn-mandatory-chain-response",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "SEGOC turn mandatory chain response resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-segoc-turn-mandatory-before-opponent-chain" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-mandatory-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens turn-player chain-response priority after an opponent mandatory trigger when a chain response exists",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-segoc-turn-mandatory-before-opponent-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-segoc-opponent-mandatory-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-segoc-turn-mandatory-chain-response", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 1, 3), chainPassGroup(0, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-turn-mandatory-chain-response" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the mandatory SEGOC chain after the turn player adds the only legal response",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(4)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-chain-response" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 4, "triggerBucket"),
            ],
            logIncludes: ["SEGOC turn mandatory chain response resolved", "SEGOC opponent mandatory chain resolved", "SEGOC turn mandatory before opponent chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves mandatory SEGOC trigger chains after the only turn-player chain response",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-chain-response" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 4, "triggerBucket"),
        ],
        logIncludes: ["SEGOC turn mandatory chain response resolved", "SEGOC opponent mandatory chain resolved", "SEGOC turn mandatory before opponent chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("returns opponent mandatory activations directly to open fast-effect priority when no chain response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After Mandatory", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent mandatory activation open fast SEGOC fixture",
      options: { seed: 59, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-mandatory-before-opponent-open",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC turn mandatory before opponent open resolved",
          },
          {
            id: "fixture-segoc-opponent-mandatory-open",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC opponent mandatory open resolved",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-mandatory",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent mandatory resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-segoc-turn-mandatory-before-opponent-open" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-mandatory-open" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves mandatory SEGOC trigger chains immediately when no legal chain response exists",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory" },
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-open" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-mandatory", 3, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 3, "triggerBucket"),
            ],
            logIncludes: ["SEGOC opponent mandatory open resolved", "SEGOC turn mandatory before opponent open resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-mandatory" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after an unresponded mandatory SEGOC chain",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-before-opponent-open" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-mandatory-open" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-open", "turnMandatory", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent mandatory resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after resolving the post-mandatory SEGOC open fast effect",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-before-opponent-open" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-mandatory-open" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-open", "turnMandatory", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent mandatory resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
