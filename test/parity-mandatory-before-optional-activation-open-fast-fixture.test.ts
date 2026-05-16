import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  openEffectGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity mandatory before optional activation open fast fixture", () => {
  it("returns mandatory-before-optional activations to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After Optional", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Opponent Open Quick After Optional", kind: "monster", attack: 600, defense: 600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory before optional activation open fast fixture",
      options: { seed: 422, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "400", "500"] },
        1: { main: ["600", "100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-activation-open-mandatory-first",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Activation open mandatory trigger resolved",
          },
          {
            id: "fixture-activation-open-optional-second",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Activation open optional trigger resolved",
          },
          {
            id: "fixture-activation-open-fast-after-optional",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Activation open fast after optional resolved",
          },
          {
            id: "fixture-activation-opponent-open-fast-filtered",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Activation opponent open fast should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-activation-open-mandatory-first" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the mandatory trigger bucket restorable before same-player optional triggers or open fast effects can proceed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-activation-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-activation-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-activation-open-mandatory-first", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(0, "fixture-activation-open-mandatory-first", "turnMandatory", 1, 1)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-activation-open-fast-after-optional" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-activation-open-fast-after-optional", 1, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps same-player optional triggers ahead of open fast effects after same-player mandatory triggers are selected",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-activation-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-activation-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-activation-open-optional-second", "turnOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-fast-after-optional" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-activation-open-fast-after-optional", 2, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 2, "triggerBucket"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-activation-open-optional-second" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the same-player optional trigger bucket restorable before open fast effects are exposed",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-activation-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-activation-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-activation-open-optional-second", "turnOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-open-fast-after-optional" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-activation-open-fast-after-optional", 2, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves selected same-player mandatory and optional trigger chains before returning to turn-player open fast priority",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-activation-open-mandatory-first" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-activation-open-mandatory-first", "turnMandatory", 3, "triggerBucket"),
              absentTriggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 3, "open"),
            ],
            logIncludes: ["Activation open optional trigger resolved", "Activation open mandatory trigger resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-activation-open-fast-after-optional" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps turn-player open fast priority restorable after mandatory and optional trigger activations resolve",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-activation-open-mandatory-first" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-activation-open-optional-second" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-activation-open-mandatory-first", "turnMandatory", 3, "triggerBucket"),
              absentTriggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 3, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves restored turn-player open fast effects after same-player mandatory and optional trigger activations",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 },
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              openEffectGroup(0, "fixture-activation-open-fast-after-optional", 1, 4),
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-mandatory-first" },
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-optional-second" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-activation-opponent-open-fast-filtered" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-activation-open-mandatory-first", "turnMandatory", 4, "open"),
              absentTriggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 4, "open"),
              absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 4, "open"),
            ],
            logIncludes: ["Activation open fast after optional resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after the post-trigger open fast effect resolves",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-fast-after-optional", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          openEffectGroup(0, "fixture-activation-open-fast-after-optional", 1, 4),
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-mandatory-first" },
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-activation-open-optional-second" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-activation-opponent-open-fast-filtered" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-activation-open-mandatory-first", "turnMandatory", 4, "open"),
          absentTriggerActivationGroup(0, "fixture-activation-open-optional-second", "turnOptional", 4, "open"),
          absentWindowEffectGroup(1, "fixture-activation-opponent-open-fast-filtered", 4, "open"),
        ],
        logIncludes: ["Activation open fast after optional resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
