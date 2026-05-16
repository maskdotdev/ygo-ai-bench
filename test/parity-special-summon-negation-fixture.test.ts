import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity special summon negation fixtures", () => {
  it("removes special-summon-success triggers when an inherent Special Summon is negated", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Special Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Special Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Special Negation Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon negation removes success trigger fixture",
      options: { seed: 233, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-inherent-special-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "fixture-special-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoning",
            triggerTiming: "if",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture special summon negator resolved",
          },
          {
            id: "fixture-special-negated-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummonNegated",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture special-summon-negated watcher resolved",
          },
          {
            id: "fixture-special-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture special-summon-success watcher should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "fixture-inherent-special-summon" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes inherent Special Summon procedures before committing the summon attempt and collecting negation triggers",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "specialSummonProcedure", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", effectId: "fixture-inherent-special-summon", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "specialSummonProcedure", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", effectId: "fixture-inherent-special-summon", count: 1 },
                ],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes inherent Special Summon negation responses before matching Special Summon success triggers can resolve",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-special-summon-negator", eventName: "specialSummoning", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "fixture-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-special-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-special-summon-negator", "turnOptional", 1, 1),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-special-summon-negator" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Special Summon negation trigger-order prompt restorable before selecting the negation response",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-special-summon-negator", eventName: "specialSummoning", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "fixture-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-summon-negator", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-special-summon-negator", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-special-summon-negator", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-special-summon-negator", "turnOptional", 1, 1),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro removes the Special Summon success trigger after the inherent Special Summon negation response resolves",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-special-negated-watcher", eventName: "specialSummonNegated", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { graveyard: ["100"], hand: ["200", "300"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-special-negated-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-special-negated-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-special-negated-watcher", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-special-negated-watcher", "turnOptional", 1, 2),
            ],
            logIncludes: ["Fixture special summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-special-negated-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves Special Summon negated triggers without resolving removed Special Summon success triggers",
        windowId: 3,
        windowKind: "open",
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
        logIncludes: ["Fixture special-summon-negated watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
