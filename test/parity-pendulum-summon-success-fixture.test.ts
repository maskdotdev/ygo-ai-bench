import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Pendulum Summon success fixtures", () => {
  it("opens Pendulum Summon actions for face-up Extra Deck monsters and resolves success triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Low Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1, attack: 1000, defense: 1000 },
      { code: "200", name: "High Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8, attack: 1000, defense: 1000 },
      { code: "300", name: "Pendulum Extra Candidate", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1500, defense: 1500 },
      { code: "400", name: "Pendulum Summon Success Watcher", kind: "monster", level: 4, attack: 1000, defense: 1000 },
      { code: "500", name: "Pendulum Hand Candidate", kind: "monster", typeFlags: 0x1000001, level: 5, attack: 1500, defense: 1500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "pendulum summon success trigger fixture",
      options: { seed: 253, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "400", "500"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "200", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "monsterZone", to: "extraDeck" },
        ],
        effects: [
          {
            id: "fixture-pendulum-success-watcher",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Fixture Pendulum summon success watcher resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep({ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"], label: "Pendulum Summon selected Extra Deck candidate" }, {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes eligible Pendulum Summons as Main Phase legal actions and lets the player choose a legal subset between active scales",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            legalActionCounts: { 0: 5, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-500-4", "p0-deck-300-2"], windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "normalSummon", player: 0, code: "400", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "setMonster", player: 0, code: "400", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-500-4", "p0-deck-300-2"], windowId: 0, windowKind: "open", count: 1 },
                ],
              },
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
            locations: { spellTrapZone: ["100", "200"], extraDeck: ["300"], hand: ["400", "500"] },
            cards: [{ uid: "p0-deck-300-2", code: "300", location: "extraDeck", faceUp: true, position: "faceDown" }],
          },
          after: {
            source: "edopro",
            note: "EDOPro Pendulum Summons the selected legal subset and queues Special Summon success triggers",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-pendulum-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-300-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
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
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
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
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },
            cards: [{ uid: "p0-deck-300-2", code: "300", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-pendulum-success-watcher" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro Pendulum Summons the selected legal subset and queues Special Summon success triggers",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-pendulum-success-watcher", eventName: "specialSummoned", eventCardUid: "p0-deck-300-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
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
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
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
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-pendulum-success-watcher", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
            locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },
            cards: [{ uid: "p0-deck-300-2", code: "300", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the Special Summon success trigger after the Pendulum Summon",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, code: "400", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "setMonster", player: 0, code: "400", location: "hand", windowId: 2, windowKind: "open", count: 1 },
              { type: "tributeSummon", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 2, windowKind: "open", count: 1 },
              { type: "tributeSet", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 2, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "tributeSummon", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"] },
                { type: "tributeSet", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"] },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-500-4"], windowId: 2, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-500-4"], windowId: 2, windowKind: "open" }],
              },
            ],
            logIncludes: ["Fixture Pendulum summon success watcher resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the Pendulum Summoned monster on field",
        phase: "main1",
        windowId: 2,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, code: "400", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "400", location: "hand", windowId: 2, windowKind: "open", count: 1 },
          { type: "tributeSummon", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 2, windowKind: "open", count: 1 },
          { type: "tributeSet", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 2, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "tributeSummon", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"] },
            { type: "tributeSet", player: 0, code: "500", location: "hand", tributeUids: ["p0-deck-300-2"] },
          ], 1, 2),
          turnGroup(2),
        ],
        logIncludes: ["Fixture Pendulum summon success watcher resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
