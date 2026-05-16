import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chainEnded open fast-effect no-response fixture", () => {
  it("auto-resolves post-chainEnded open fast effects when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Ended No Response Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Chain Ended No Response Solved Blocker", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Chain Ended No Response Cleanup", kind: "monster", attack: 1500, defense: 1600 },
      { code: "400", name: "Chain Ended No Response Open Quick", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "deferred chain ended open fast no-response fixture",
      options: { seed: 617, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "400"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "chain-ended-no-response-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            logMessage: "Chain ended no-response starter resolved",
          },
          {
            id: "chain-ended-no-response-solved-blocker",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Chain ended no-response solved blocker should not resolve",
          },
          {
            id: "chain-ended-no-response-cleanup",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainEnded",
            optional: false,
            triggerTiming: "if",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 0, code: "200", from: "hand", to: "graveyard" }],
            logMessage: "Chain ended no-response cleanup resolved",
          },
          {
            id: "chain-ended-no-response-open-fast",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Chain ended no-response open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "chain-ended-no-response-starter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial open window restorable before the starter creates deferred chainEnded work",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-solved-blocker" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "chain-ended-no-response-cleanup" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro defers chainEnded triggers while a chainSolved optional trigger bucket is pending",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "chain-ended-no-response-solved-blocker", eventName: "chainSolved", triggerBucket: "turnOptional", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-cleanup", triggerBucket: "turnMandatory" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 1, "triggerBucket"),
            ],
            logIncludes: ["Chain ended no-response starter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "chain-ended-no-response-solved-blocker" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the chainSolved optional trigger bucket restorable before it is declined",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "chain-ended-no-response-solved-blocker", eventName: "chainSolved", triggerBucket: "turnOptional", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-cleanup", triggerBucket: "turnMandatory" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "chain-ended-no-response-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro collects the deferred mandatory chainEnded bucket after the chainSolved optional bucket is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "chain-ended-no-response-cleanup", eventName: "chainEnded", triggerBucket: "turnMandatory", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-cleanup", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [triggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 2, "triggerBucket"),
            ],
            logIncludes: ["chain-ended-no-response-solved-blocker"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "chain-ended-no-response-cleanup" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the deferred mandatory chainEnded bucket restorable before cleanup resolves",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "chain-ended-no-response-cleanup", eventName: "chainEnded", triggerBucket: "turnMandatory", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-cleanup", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [triggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-solved-blocker", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "chain-ended-no-response-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro opens post-chainEnded fast effects only after the deferred mandatory trigger resolves",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { graveyard: ["200"] },
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-solved-blocker" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-cleanup" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 3, "open"),
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 3, "open"),
            ],
            logIncludes: ["Chain ended no-response cleanup resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "chain-ended-no-response-open-fast" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the post-chainEnded open fast window restorable before the no-response quick effect resolves",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { graveyard: ["200"] },
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-open-fast", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-solved-blocker" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "chain-ended-no-response-cleanup" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-ended-no-response-solved-blocker", "turnOptional", 3, "open"),
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 3, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves a post-chainEnded open fast-effect chain immediately when the opponent has no legal response",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { graveyard: ["200"] },
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 4,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-open-fast" },
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-cleanup" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 4, "open"),
              absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 4, "open"),
            ],
            logIncludes: ["Chain ended no-response open fast resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the post-chainEnded no-response fast-effect chain",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { graveyard: ["200"] },
        legalActionCounts: { 0: 9, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 4,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-starter", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 4),
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-open-fast" },
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "chain-ended-no-response-cleanup" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "chain-ended-no-response-open-fast", 4, "open"),
          absentTriggerActivationGroup(0, "chain-ended-no-response-cleanup", "turnMandatory", 4, "open"),
        ],
        logIncludes: ["Chain ended no-response starter resolved", "Chain ended no-response cleanup resolved", "Chain ended no-response open fast resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
