import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

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
            range: ["hand"],
            logMessage: "Fixture flip-summon-success watcher should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro exposes Flip Summon negation responses before matching Flip Summon success triggers can resolve",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-flip-summon-negator", eventName: "flipSummoning", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-flip-success-watcher", eventName: "flipSummoned", eventCardUid: "p0-deck-100-0" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-flip-summon-negator" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro removes the Flip Summon success trigger after the Flip Summon negation response resolves",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-flip-negated-watcher", eventName: "flipSummonNegated", eventCardUid: "p0-deck-100-0" }],
            locations: { graveyard: ["100"], hand: ["200", "300"] },
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
        logIncludes: ["Fixture flip-summon-negated watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
