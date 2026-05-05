import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity flip summon negation protection fixtures", () => {
  it("keeps protected flip-summon-success triggers when flip summon negation is prevented", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Flip Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Blocked Flip Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Protected Flip Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "flip summon negation protection keeps success trigger fixture",
      options: { seed: 235, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" }],
        effects: [
          {
            id: "fixture-cannot-disable-flip-summon",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 39,
            range: ["monsterZone"],
          },
          {
            id: "fixture-blocked-flip-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "flipSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture blocked flip summon negator resolved",
          },
          {
            id: "fixture-protected-flip-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "flipSummoned",
            range: ["hand"],
            logMessage: "Fixture protected flip-summon-success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro still opens flip-summon-negation response timing for Flip Summons protected by EFFECT_CANNOT_DISABLE_FLIP_SUMMON",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-flip-summon-negator", eventName: "flipSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-flip-success-watcher", eventName: "flipSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-blocked-flip-summon-negator" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro keeps the Flip Summon success trigger when EFFECT_CANNOT_DISABLE_FLIP_SUMMON prevents summon negation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-protected-flip-success-watcher", eventName: "flipSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            logIncludes: ["Fixture blocked flip summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-protected-flip-success-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the protected Flip Summon success trigger after blocked summon negation",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200", "300"] },
        logIncludes: ["Fixture protected flip-summon-success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
