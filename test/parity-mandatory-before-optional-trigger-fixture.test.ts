import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity mandatory before optional trigger fixtures", () => {
  it("holds same-player optional triggers until mandatory triggers resolve", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional Trigger", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "same-player mandatory before optional fixture",
      options: { seed: 52, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-mandatory-first",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Mandatory trigger resolved",
          },
          {
            id: "fixture-optional-second",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Optional trigger resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          after: {
            source: "edopro",
            note: "EDOPro hides same-player optional triggers while same-player mandatory triggers in the same event remain pending",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-mandatory-first", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, effectId: "fixture-mandatory-first", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, effectId: "fixture-mandatory-first" },
              { type: "activateTrigger", player: 0, effectId: "fixture-optional-second" },
              { type: "declineTrigger", player: 0, effectId: "fixture-optional-second" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "declineTrigger", player: 0, effectId: "fixture-mandatory-first" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-mandatory-first" }), {
          after: {
            source: "edopro",
            note: "EDOPro presents same-player optional triggers only after same-player mandatory triggers are consumed",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-second", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-second", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, effectId: "fixture-optional-second", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, effectId: "fixture-optional-second", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-optional-second" }), {
          snapshotRestore: true,
          before: {
            source: "edopro",
            note: "EDOPro allows the optional trigger to be declined once the mandatory bucket is empty",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-second", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, effectId: "fixture-optional-second", count: 1 }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state has no remaining optional trigger actions after the optional trigger is declined",
        windowId: 3,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["300", "400"] },
        logIncludes: ["Mandatory trigger resolved", "fixture-optional-second"],
        absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-optional-second" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 3,
            windowKind: "triggerBucket",
            actions: [{ type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-optional-second" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
