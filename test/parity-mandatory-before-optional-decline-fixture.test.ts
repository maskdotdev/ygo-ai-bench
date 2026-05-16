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

describe("EDOPro parity mandatory before optional decline fixture", () => {
  it("returns mandatory-before-optional declines to open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Open Quick After Optional", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory before optional decline open fast fixture",
      options: { seed: 54, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "400", "500"] },
        1: { main: ["100", "100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-open-mandatory-first",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Open mandatory trigger resolved",
          },
          {
            id: "fixture-open-optional-second",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Open optional trigger should not resolve",
          },
          {
            id: "fixture-open-fast-after-optional-decline",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Open fast after optional decline resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-open-mandatory-first" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps same-player mandatory triggers restorable before advancing to same-player optional trigger buckets",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 0, effectId: "fixture-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnMandatory" },
              { player: 0, triggerBucket: "turnOptional" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-mandatory-first", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(0, "fixture-open-mandatory-first", "turnMandatory", 1, 1)],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-mandatory-first", triggerBucket: "turnMandatory" },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional" },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-decline" },
            ],
            absentLegalActionGroups: [
              triggerDeclineGroup(0, "fixture-open-mandatory-first", "turnMandatory", 1, 1),
              absentTriggerActivationGroup(0, "fixture-open-optional-second", "turnOptional", 1, "triggerBucket"),
              triggerDeclineGroup(0, "fixture-open-optional-second", "turnOptional", 1, 1),
              absentWindowEffectGroup(0, "fixture-open-fast-after-optional-decline", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes same-player optional triggers after same-player mandatory triggers are selected",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-decline" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-decline" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-open-optional-second" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the optional bucket decline restorable before returning to open fast-effect priority",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-open-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-open-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-optional-second", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-open-optional-second", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-open-optional-second", "turnOptional", 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-decline" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-open-fast-after-optional-decline", 2, "triggerBucket")],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes turn-player open fast effects after the optional bucket behind a mandatory trigger is declined",
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
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-open-fast-after-optional-decline", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-open-fast-after-optional-decline", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" },
              { type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 3,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 3,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" }],
              },
            ],
            logIncludes: ["Open mandatory trigger resolved", "fixture-open-optional-second"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-open-fast-after-optional-decline" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the post-decline open fast-effect window restorable before resolving the open fast effect",
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
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-open-fast-after-optional-decline", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "fixture-open-fast-after-optional-decline", 1, 3), turnGroup(3)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" },
              { type: "declineTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-open-optional-second" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-open-optional-second", "turnOptional", 3, "triggerBucket"),
              triggerDeclineGroup(0, "fixture-open-optional-second", "turnOptional", 1, 3),
            ],
            logIncludes: ["Open mandatory trigger resolved", "fixture-open-optional-second"],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after declining the optional bucket behind a mandatory trigger",
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
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-fast-after-optional-decline", count: 1 },
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              openEffectGroup(0, "fixture-open-fast-after-optional-decline", 1, 4),
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-mandatory-first" },
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-optional-second" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 4,
                windowKind: "open",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-mandatory-first" }],
              },
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 4,
                windowKind: "open",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-optional-second" }],
              },
            ],
            logIncludes: ["Open fast after optional decline resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after resolving the post-decline open fast effect",
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
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-fast-after-optional-decline", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          openEffectGroup(0, "fixture-open-fast-after-optional-decline", 1, 4),
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-mandatory-first" },
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-optional-second" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 4,
            windowKind: "open",
            triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
            actions: [{ type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-mandatory-first" }],
          },
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 4,
            windowKind: "open",
            triggerBucket: { player: 0, triggerBucket: "turnOptional" },
            actions: [{ type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-open-optional-second" }],
          },
        ],
        logIncludes: ["Open fast after optional decline resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
