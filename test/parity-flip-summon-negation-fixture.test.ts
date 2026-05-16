import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity flip summon negation fixtures", () => {
  it("removes flip-summon-success triggers when a Flip Summon is negated", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Flip Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Flip Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Flip Negation Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "flip summon negation removes success trigger fixture",
      options: { seed: 232, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" }],
        effects: [
          {
            id: "fixture-flip-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "flipSummoning",
            triggerTiming: "if",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture flip summon negator resolved",
          },
          {
            id: "fixture-flip-negated-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "flipSummonNegated",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture flip-summon-negated watcher resolved",
          },
          {
            id: "fixture-flip-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "flipSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture flip-summon-success watcher should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase Flip Summon action restorable before committing the summon attempt",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense" }],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "flipSummon", player: 0, code: "100", location: "monsterZone", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "flipSummon", player: 0, code: "100", location: "monsterZone" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes Flip Summon negation responses before matching Flip Summon success triggers can resolve",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-flip-summon-negator", eventName: "flipSummoning", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "fixture-flip-success-watcher", eventName: "flipSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-flip-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-flip-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-flip-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-flip-summon-negator", "turnOptional", 1, 1),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-flip-summon-negator" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Flip Summon negation trigger bucket restorable before selecting the negation response",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-flip-summon-negator", eventName: "flipSummoning", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "fixture-flip-success-watcher", eventName: "flipSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-flip-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-flip-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-flip-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-flip-summon-negator", "turnOptional", 1, 1),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro removes the Flip Summon success trigger after the Flip Summon negation response resolves",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-flip-negated-watcher", eventName: "flipSummonNegated", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { graveyard: ["100"], hand: ["200", "300"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-flip-negated-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-flip-negated-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-flip-negated-watcher", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-flip-negated-watcher", "turnOptional", 1, 2),
            ],
            logIncludes: ["Fixture flip summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-flip-negated-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves Flip Summon negated triggers without resolving removed Flip Summon success triggers",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { graveyard: ["100"], hand: ["200", "300"] },
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, code: "200", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "normalSummon", player: 0, code: "300", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "200", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "300", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        logIncludes: ["Fixture flip-summon-negated watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
