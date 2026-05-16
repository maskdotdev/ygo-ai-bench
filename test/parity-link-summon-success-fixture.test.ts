import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Link Summon success fixtures", () => {
  it("opens Link Summon actions, sends materials to Graveyard, and resolves success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Link Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Second Link Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Link Summon Success Watcher", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Link Two Monster", kind: "extra", typeFlags: 0x4000001, level: 2, attack: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "link summon success trigger fixture",
      options: { seed: 250, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"], extra: ["900"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-link-success-watcher",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture Link summon success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("linkSummon", 0, { code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"] }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes eligible Link Summons as Main Phase legal actions with selected field materials",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "linkSummon", player: 0, code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"], windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "linkSummon", player: 0, code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"] },
              ], 1, 0),
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["100", "200"], hand: ["300"], extraDeck: ["900"] },
          },
          after: {
            source: "edopro",
            note: "EDOPro sends Link materials to the Graveyard and queues Special Summon success triggers after the Link Summon",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-link-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-extraDeck-900-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["900"], graveyard: ["100", "200"], hand: ["300"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-link-success-watcher" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro sends Link materials to the Graveyard and queues Special Summon success triggers after the Link Summon",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-link-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-extraDeck-900-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-link-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["900"], graveyard: ["100", "200"], hand: ["300"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the Special Summon success trigger after the Link monster reaches the field",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, code: "300", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "setMonster", player: 0, code: "300", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            logIncludes: ["Fixture Link summon success watcher resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the Link monster on field and its materials in the Graveyard",
        phase: "main1",
        windowId: 2,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["900"], graveyard: ["100", "200"], hand: ["300"] },
        legalActionCounts: { 0: 4, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, code: "300", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "300", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        logIncludes: ["Fixture Link summon success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
