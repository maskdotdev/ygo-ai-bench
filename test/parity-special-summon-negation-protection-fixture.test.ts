import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity special summon negation protection fixtures", () => {
  it("keeps protected special-summon-success triggers when summon negation is prevented", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Special Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Blocked Special Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Protected Special Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon negation protection keeps success trigger fixture",
      options: { seed: 234, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-inherent-protected-special-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "fixture-cannot-disable-special-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 26,
            range: ["monsterZone"],
          },
          {
            id: "fixture-blocked-special-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture blocked special summon negator resolved",
          },
          {
            id: "fixture-protected-special-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            range: ["hand"],
            logMessage: "Fixture protected special-summon-success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "fixture-inherent-protected-special-summon" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro still opens summon-negation response timing for inherent Special Summons protected by EFFECT_CANNOT_DISABLE_SUMMON",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-special-summon-negator", eventName: "specialSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-blocked-special-summon-negator" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro keeps the Special Summon success trigger when EFFECT_CANNOT_DISABLE_SUMMON prevents summon negation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-protected-special-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0" }],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            logIncludes: ["Fixture blocked special summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-protected-special-success-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the protected Special Summon success trigger after blocked summon negation",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200", "300"] },
        logIncludes: ["Fixture protected special-summon-success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
