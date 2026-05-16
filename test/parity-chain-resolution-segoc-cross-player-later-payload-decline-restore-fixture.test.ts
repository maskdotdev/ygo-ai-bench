import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player later-payload decline restore fixture", () => {
  it("restores a later-payload opponent trigger bucket and returns to open priority after decline", () => {
    const firstEventCode = 0x10000033;
    const secondEventCode = 0x10000034;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload Decline Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload Decline Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload Decline Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload Decline Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload Decline Opponent Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Payload Decline Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload Decline Filler", kind: "monster", attack: 800, defense: 800 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload decline restore fixture",
      options: { seed: 391, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "300", "500", "800", "800"] },
        1: { main: ["400", "600", "700", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-decline-starter",
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
            logMessage: "Cross payload decline starter resolved",
          },
          {
            id: "fixture-cross-payload-decline-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerTiming: "if",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload decline turn trigger resolved",
          },
          {
            id: "fixture-cross-payload-decline-opponent-trigger",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerTiming: "if",
            triggerCode: secondEventCode,
            range: ["hand"],
            logMessage: "Cross payload decline opponent trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-decline-opponent-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload decline opponent quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-decline-starter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial open priority restorable before cross-player later-payload decline queues are created",
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
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-decline-starter", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-decline-starter", count: 1 }],
              },
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-decline-opponent-quick" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 0, "open"),
              absentTriggerActivationGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 0, "open"),
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
              { player: 0, effectId: "fixture-cross-payload-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, triggerBucket: "turnOptional", eventCardUid: "p0-deck-500-2", eventTriggerTiming: "if" },
              { player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 1, "triggerBucket"),
            ],
            locations: { graveyard: ["500", "700", "600"], hand: ["100", "300", "800", "800", "400", "800", "800"] },
            logIncludes: ["Cross payload decline starter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-payload-decline-turn-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the active cross-player later-payload decline turn bucket restorable before selecting the turn trigger",
            phase: "main1",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-cross-payload-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, triggerBucket: "turnOptional", eventCardUid: "p0-deck-500-2", eventTriggerTiming: "if" },
              { player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 1, "triggerBucket"),
            ],
            locations: { graveyard: ["500", "700", "600"], hand: ["100", "300", "800", "800", "400", "800", "800"] },
            logIncludes: ["Cross payload decline starter resolved"],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the restored later-payload opponent bucket hidden while chain responses are available",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-cross-payload-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, eventCardUid: "p0-deck-500-2", eventTriggerTiming: "if" }],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-cross-payload-decline-opponent-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-cross-payload-decline-opponent-trigger" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 2, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the hidden cross-player later-payload decline opponent bucket restorable while opponent chain-response priority is active",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-cross-payload-decline-turn-trigger", eventName: "customEvent", eventCode: firstEventCode, eventCardUid: "p0-deck-500-2", eventTriggerTiming: "if" }],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-cross-payload-decline-opponent-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-cross-payload-decline-opponent-trigger" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 2, "chainResponse")],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances the restored later-payload opponent optional bucket after the first trigger chain resolves",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, 3),
              triggerDeclineGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, 3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 3, "triggerBucket"),
            ],
            logIncludes: ["Cross payload decline turn trigger resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-cross-payload-decline-opponent-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the restored later-payload opponent optional bucket before the opponent trigger is declined",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-payload-decline-opponent-trigger", eventName: "customEvent", eventCode: secondEventCode, triggerBucket: "opponentOptional", eventCardUid: "p1-deck-700-2", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, 3),
              triggerDeclineGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 1, 3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-payload-decline-opponent-quick" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-payload-decline-turn-trigger", "turnOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 3, "triggerBucket"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns restored later-payload opponent optional declines to turn-player open priority",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 11, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-cross-payload-decline-starter", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 4,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-cross-payload-decline-starter", count: 1 }],
          },
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-cross-payload-decline-opponent-trigger", triggerBucket: "opponentOptional" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-cross-payload-decline-opponent-quick" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(1, "fixture-cross-payload-decline-opponent-trigger", "opponentOptional", 4, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-decline-opponent-quick", 4, "open"),
        ],
        locations: { graveyard: ["500", "700", "600"], hand: ["100", "300", "800", "800", "400", "800", "800"] },
        logIncludes: ["Cross payload decline starter resolved", "Cross payload decline turn trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
