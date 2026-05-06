import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity special summon sp-negation protection fixtures", () => {
  it("keeps protected special-summon-success triggers when special summon negation is prevented", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected SP Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Blocked SP Summon Negator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Protected SP Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon sp-negation protection keeps success trigger fixture",
      options: { seed: 236, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: [] },
      },
      setup: {
        effects: [
          {
            id: "fixture-inherent-sp-protected-special-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "fixture-cannot-disable-sp-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 27,
            range: ["monsterZone"],
          },
          {
            id: "fixture-blocked-sp-summon-negator",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoning",
            range: ["hand"],
            negateSummonOnResolve: { player: 0, code: "100", location: "monsterZone" },
            logMessage: "Fixture blocked SP summon negator resolved",
          },
          {
            id: "fixture-protected-sp-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            range: ["hand"],
            logMessage: "Fixture protected SP summon-success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "fixture-inherent-sp-protected-special-summon" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro still opens summon-negation response timing for inherent Special Summons protected by EFFECT_CANNOT_DISABLE_SPSUMMON",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-blocked-sp-summon-negator", eventName: "specialSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-protected-sp-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-blocked-sp-summon-negator" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps the Special Summon success trigger when EFFECT_CANNOT_DISABLE_SPSUMMON prevents summon negation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-protected-sp-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locations: { monsterZone: ["100"], hand: ["200", "300"] },
            logIncludes: ["Fixture blocked SP summon negator resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-protected-sp-success-watcher" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the protected Special Summon success trigger after blocked EFFECT_CANNOT_DISABLE_SPSUMMON negation",
        windowId: 3,
        phase: "main1",
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["200", "300"] },
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
        logIncludes: ["Fixture protected SP summon-success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
