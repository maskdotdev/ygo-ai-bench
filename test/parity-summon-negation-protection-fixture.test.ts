import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity summon negation protection fixtures", () => {
  it("keeps protected summon-success triggers when summon negation is prevented", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Normal Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Blocked Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Protected Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon negation protection keeps success trigger fixture",
      options: { seed: 231, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cannot-disable-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 26,
            range: ["monsterZone"],
          },
          {
            id: "fixture-blocked-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture blocked summon negator resolved",
          },
          {
            id: "fixture-protected-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            range: ["hand"],
            logMessage: "Fixture protected summon-success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro still opens summon-negation response timing for Normal Summons protected by EFFECT_CANNOT_DISABLE_SUMMON",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-summon-negator", eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-blocked-summon-negator" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro keeps the Normal Summon success trigger when EFFECT_CANNOT_DISABLE_SUMMON prevents summon negation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-protected-success-watcher", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            logIncludes: ["Fixture blocked summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-protected-success-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the protected Normal Summon success trigger after blocked summon negation",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200", "300"] },
        logIncludes: ["Fixture protected summon-success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
