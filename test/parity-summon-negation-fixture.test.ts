import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity summon negation fixtures", () => {
  it("removes summon-success triggers when a summon attempt is negated", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Normal Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Negated Summon Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon negation removes success trigger fixture",
      options: { seed: 230, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture summon negator resolved",
          },
          {
            id: "fixture-negated-summon-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummonNegated",
            range: ["hand"],
            logMessage: "Fixture summon-negated watcher resolved",
          },
          {
            id: "fixture-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Fixture summon-success watcher should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes summon-negation responses before matching Normal Summon success triggers can resolve",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-summon-negator", eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-summon-negator" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro removes the Normal Summon success trigger after the summon-negation response resolves",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-negated-summon-watcher", eventName: "normalSummonNegated", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { graveyard: ["100"], hand: ["200", "300"] },
            logIncludes: ["Fixture summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-negated-summon-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves summon-negated triggers without resolving removed summon-success triggers",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { graveyard: ["100"], hand: ["200", "300"] },
        logIncludes: ["Fixture summon-negated watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
