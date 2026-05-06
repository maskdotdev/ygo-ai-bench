import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity sent-to-hand missed timing decline fixture", () => {
  it("returns declined optional if sent-to-hand triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Bounce Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Bounce Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Bounce Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Bounce", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Bounced Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "sent-to-hand missed timing decline open fast fixture",
      options: { seed: 67, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "600", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "bounce-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "600", from: "monsterZone", to: "hand", collectEvent: "sentToHand", eventIsLast: false },
              { player: 0, code: "700", from: "monsterZone", to: "graveyard" },
            ],
            logMessage: "Bounce decline multi step resolved",
          },
          {
            id: "bounce-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHand",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Bounce decline optional when should not resolve",
          },
          {
            id: "bounce-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHand",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Bounce decline optional if should not resolve",
          },
          {
            id: "bounce-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Bounce decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "bounce-decline-multistep" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if sent-to-hand triggers available while optional when sent-to-hand triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "bounce-decline-optional-if", eventName: "sentToHand", eventCardUid: "p0-deck-600-4" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-if", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-if", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-optional-when" }],
              },
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "bounce-decline-open-fast" }],
              },
            ],
            logIncludes: ["Bounce decline multi step resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "bounce-decline-optional-if" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if sent-to-hand trigger without resurrecting missed optional when triggers",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-open-fast", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-open-fast", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "open",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-optional-when" },
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "bounce-decline-optional-if" },
                ],
              },
            ],
            logIncludes: ["Bounce decline multi step resolved", "bounce-decline-optional-if"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "bounce-decline-open-fast" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored post-decline open fast effect without resurrecting missed optional when triggers",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 3,
                windowKind: "open",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-when" },
                  { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-if" },
                ],
              },
            ],
            logIncludes: ["Bounce decline open fast resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the restored post-decline open fast effect while optional when remains missed",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 14, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 3,
            windowKind: "open",
            triggerBucket: { player: 0, triggerBucket: "turnOptional" },
            actions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "bounce-decline-optional-if" },
            ],
          },
        ],
        logIncludes: ["Bounce decline open fast resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
