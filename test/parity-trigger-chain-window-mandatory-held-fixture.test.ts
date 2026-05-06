import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger chain-window mandatory held fixture", () => {
  it("holds mandatory sibling triggers behind the active trigger chain window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Mandatory Chain Window Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "First Mandatory Chain Window Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory Chain Window Quick", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Second Mandatory Held Trigger", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory trigger chain window held sibling fixture",
      options: { seed: 183, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-first-mandatory-chain-window-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "First mandatory trigger resolved",
          },
          {
            id: "fixture-second-mandatory-held-trigger",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Second mandatory held trigger resolved",
          },
          {
            id: "fixture-opponent-mandatory-chain-window-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            logMessage: "Opponent mandatory chain-window quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes same-bucket mandatory trigger choices without decline actions before fast responses",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnMandatory" },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", count: 1 },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", count: 1 },
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, effectId: "fixture-first-mandatory-chain-window-trigger" },
              { type: "declineTrigger", player: 0, effectId: "fixture-second-mandatory-held-trigger" },
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-mandatory-chain-window-quick", windowId: 1, windowKind: "triggerBucket" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory-chain-window-trigger" },
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger" },
                ],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-mandatory-chain-window-quick", windowId: 1, windowKind: "triggerBucket" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-first-mandatory-chain-window-trigger" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps the remaining mandatory sibling trigger before exposing chain-response quick effects",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-first-mandatory-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, effectId: "fixture-second-mandatory-held-trigger" },
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-mandatory-chain-window-quick", windowId: 2, windowKind: "triggerBucket" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-second-mandatory-held-trigger" }],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-mandatory-chain-window-quick", windowId: 2, windowKind: "triggerBucket" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-second-mandatory-held-trigger" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens fast responses after all mandatory SEGOC trigger choices are made",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [
              { player: 0, effectId: "fixture-first-mandatory-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-second-mandatory-held-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggers: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "fixture-opponent-mandatory-chain-window-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 3,
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "fixture-opponent-mandatory-chain-window-quick", count: 1 }],
              },
              {
                player: 1,
                label: "Pass",
                windowId: 3,
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves selected mandatory sibling trigger chains after the fast-response player passes",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(4)],
            logIncludes: ["First mandatory trigger resolved", "Second mandatory held trigger resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves mandatory sibling trigger chains after the fast-effect window closes",
        windowId: 4,
        windowKind: "open",
        phase: "main1",
        waitingFor: 0,
        chain: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        locations: { monsterZone: ["100"], hand: ["300", "400", "500"] },
        logIncludes: ["First mandatory trigger resolved", "Second mandatory held trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
