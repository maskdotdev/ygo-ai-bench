import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity normal-summoning missed timing fixture", () => {
  it("resolves optional if normal-summoning triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Attempt Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Normal Summoning Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Normal Summoning Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Normal Summon Attempt", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Normal Summoning Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal-summoning missed timing activation fixture",
      options: { seed: 294, startingHandSize: 6 },
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
            id: "normal-summoning-activation-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "normalSummoning",
                eventCard: { player: 0, code: "600", location: "monsterZone" },
                eventIsLast: false,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Normal summoning activation multi step resolved",
          },
          {
            id: "normal-summoning-activation-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoning",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Normal summoning activation optional when should not resolve",
          },
          {
            id: "normal-summoning-activation-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoning",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Normal summoning activation optional if resolved",
          },
          {
            id: "normal-summoning-activation-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Normal summoning activation open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "normal-summoning-activation-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial normal-summon-attempt effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summoning-activation-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summoning-activation-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "normal-summoning-activation-open-fast", 1, 0)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summoning-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summoning-activation-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-when", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 0, "open"),
            ],
            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if normal-summon-attempt triggers available while optional when normal-summon-attempt triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "normal-summoning-activation-optional-if", eventName: "normalSummoning", eventCode: 1103, eventCardUid: "p0-deck-600-4" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "normal-summoning-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-open-fast" },
            ],
            logIncludes: ["Normal summoning activation multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "normal-summoning-activation-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if normal-summon-attempt trigger activation restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "normal-summoning-activation-optional-if", eventName: "normalSummoning", eventCode: 1103, eventCardUid: "p0-deck-600-4" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionGroups: [
              triggerActivationGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "normal-summoning-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoning-activation-open-fast" },
            ],
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if normal-summon-attempt trigger and returns to open fast priority",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "normal-summoning-activation-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-optional-if" },
            ],
            logIncludes: ["Normal summoning activation multi step resolved", "Normal summoning activation optional if resolved"],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the normal-summon-attempt optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "normal-summoning-activation-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "normal-summoning-activation-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "normal-summoning-activation-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoning-activation-optional-if" },
        ],
        logIncludes: ["Normal summoning activation multi step resolved", "Normal summoning activation optional if resolved"],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 4, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
