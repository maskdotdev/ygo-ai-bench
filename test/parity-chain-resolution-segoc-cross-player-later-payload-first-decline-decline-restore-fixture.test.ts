import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player later-payload first-decline decline restore fixture", () => {
  it("returns to open priority after declining the active trigger and the restored opponent trigger", () => {
    const firstEventCode = 0x1000003d;
    const secondEventCode = 0x1000003e;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload First Double Decline Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload First Double Decline Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload First Double Decline Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload First Double Decline Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload First Double Decline Opponent Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Payload First Double Decline Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload First Double Decline Filler", kind: "monster", attack: 800, defense: 800 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload first-decline decline restore fixture",
      options: { seed: 396, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "300", "500", "800", "800"] },
        1: { main: ["400", "600", "700", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-first-double-decline-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "500", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: firstEventCode },
              { player: 1, code: "700", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: secondEventCode },
              { player: 1, code: "600", from: "hand", to: "graveyard" },
            ],
            logMessage: "Cross payload first double-decline starter resolved",
          },
          {
            id: "fixture-cross-payload-first-double-decline-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerTiming: "if",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload first double-decline turn trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-first-double-decline-opponent-trigger",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerTiming: "if",
            triggerCode: secondEventCode,
            range: ["hand"],
            logMessage: "Cross payload first double-decline opponent trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-first-double-decline-opponent-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload first double-decline opponent quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-first-double-decline-starter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial open priority restorable before cross-player later-payload double-decline trigger queues are created",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-starter", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "800", location: "hand", count: 2 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "800", location: "hand", count: 2 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-starter", count: 1 }],
              },
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 0, "open"),
              absentTriggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro restores the later-payload opponent optional bucket behind the active turn optional bucket",
            phase: "main1",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-cross-payload-first-double-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, triggerBucket: "turnOptional", eventCardUid: "p0-deck-500-2" },
              { player: 1, effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 1, "triggerBucket"),
            ],
            locations: { graveyard: ["500", "700", "600"], hand: ["100", "300", "800", "800", "400", "800", "800"] },
            logIncludes: ["Cross payload first double-decline starter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-cross-payload-first-double-decline-turn-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the active turn optional bucket before the first decline advances to the restored opponent bucket",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-cross-payload-first-double-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, triggerBucket: "turnOptional", eventCardUid: "p0-deck-500-2" },
              { player: 1, effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances the restored later-payload opponent optional bucket after the active turn optional payload is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 2, "triggerBucket"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-cross-payload-first-double-decline-opponent-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the restored later-payload opponent optional bucket before the double-decline path completes",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 2, "triggerBucket"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns double-declined restored cross-player later-payload buckets to turn-player open priority",
        phase: "main1",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 11, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-starter", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-starter", count: 1 }],
          },
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-turn-trigger", triggerBucket: "turnOptional" },
          { type: "activateTrigger", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-opponent-trigger", triggerBucket: "opponentOptional" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-cross-payload-first-double-decline-opponent-quick" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-cross-payload-first-double-decline-turn-trigger", "turnOptional", 3, "open"),
          absentTriggerActivationGroup(1, "fixture-cross-payload-first-double-decline-opponent-trigger", "opponentOptional", 3, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-first-double-decline-opponent-quick", 3, "open"),
        ],
        locations: { graveyard: ["500", "700", "600"], hand: ["100", "300", "800", "800", "400", "800", "800"] },
        logIncludes: ["Cross payload first double-decline starter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
