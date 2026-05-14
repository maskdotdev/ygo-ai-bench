import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity custom-event missed timing decline fixture", () => {
  it("returns declined optional if custom-event triggers to open fast priority while optional when remains missed", () => {
    const eventCode = 0x10000000 + 14;
    const cards: DuelCardData[] = [
      { code: "100", name: "Custom Event Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Custom Event Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Custom Event Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Custom Event", kind: "monster", attack: 500, defense: 500 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "custom-event missed timing decline open fast fixture",
      options: { seed: 317, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "800", "700"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "custom-event-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [{ collectEvent: "customEvent", eventCode, eventIsLast: false, eventPlayer: 1, eventValue: 77 }],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Custom event decline multi step resolved",
          },
          {
            id: "custom-event-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: eventCode,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Custom event decline optional when should not resolve",
          },
          {
            id: "custom-event-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: eventCode,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Custom event decline optional if should not resolve",
          },
          {
            id: "custom-event-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Custom event decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "custom-event-decline-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial custom-event effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "custom-event-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "custom-event-decline-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "custom-event-decline-open-fast", 1, 0)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if custom-event triggers available while optional when custom-event triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "custom-event-decline-optional-if", eventName: "customEvent", eventCode, eventPlayer: 1, eventValue: 77 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "custom-event-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "custom-event-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "custom-event-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "custom-event-decline-open-fast", 1, "triggerBucket"),
            ],
            logIncludes: ["Custom event decline multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "custom-event-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if custom-event trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "custom-event-decline-optional-if", eventName: "customEvent", eventCode, eventPlayer: 1, eventValue: 77 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionGroups: [
              triggerActivationGroup(0, "custom-event-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "custom-event-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "custom-event-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "custom-event-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "custom-event-decline-open-fast", 1, "triggerBucket"),
            ],
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if custom-event trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "custom-event-decline-open-fast", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "custom-event-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "custom-event-decline-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Custom event decline multi step resolved", "custom-event-decline-optional-if"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state exposes open fast effects after declining the custom-event optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "custom-event-decline-open-fast", 1, 2)],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "custom-event-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "custom-event-decline-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "custom-event-decline-optional-if", "turnOptional", 2, "open"),
        ],
        logIncludes: ["Custom event decline multi step resolved", "custom-event-decline-optional-if"],
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
