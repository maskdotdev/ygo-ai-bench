import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity optional when decline fixture", () => {
  it("returns declined optional when triggers to open fast-effect priority when their event is last", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Single Step Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Open Quick After Optional When", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Moved Body", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "optional when last-event decline open fast fixture",
      options: { seed: 55, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400", "500", "600"] },
        1: { main: ["600", "600", "600", "600"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-single-step-send-decline",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [{ player: 0, code: "600", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard" }],
            logMessage: "Single step send decline resolved",
          },
          {
            id: "fixture-optional-when-decline",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Optional when decline should not resolve",
          },
          {
            id: "fixture-open-fast-after-optional-when-decline",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Open fast after optional when decline resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-single-step-send-decline" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes optional when triggers when their triggering event is last, before open fast effects",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-when-decline", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-3" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-when-decline" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-open-fast-after-optional-when-decline" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-optional-when-decline" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro clears the last-event optional when trigger bucket after decline and exposes open fast effects",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-open-fast-after-optional-when-decline", count: 1 },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send-decline", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-open-fast-after-optional-when-decline", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send-decline", count: 1 },
                ],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-when-decline" }],
              },
            ],
            logIncludes: ["Single step send decline resolved", "fixture-optional-when-decline"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state exposes open fast effects after declining a last-event optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 10, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-open-fast-after-optional-when-decline", count: 1 },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send-decline", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-open-fast-after-optional-when-decline", count: 1 },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send-decline", count: 1 },
            ],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        logIncludes: ["Single step send decline resolved", "fixture-optional-when-decline"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
