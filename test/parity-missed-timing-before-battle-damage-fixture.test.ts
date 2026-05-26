import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity before-battle-damage missed timing fixture", () => {
  it("resolves optional if before-battle-damage triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Before Battle Damage Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Before Battle Damage Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Before Battle Damage Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Before Battle Damage", kind: "monster", attack: 500, defense: 500 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "before-battle-damage missed timing activation fixture",
      options: { seed: 353, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "800", "700"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "before-battle-damage-activation-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [{ collectEvent: "beforeBattleDamage", eventCard: { player: 0, code: "700", location: "monsterZone" }, eventCode: 1136, eventIsLast: false, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-700-4" }],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Before-battle-damage activation multi step resolved",
          },
          {
            id: "before-battle-damage-activation-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "beforeBattleDamage",
            triggerCode: 1136,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Before-battle-damage activation optional when should not resolve",
          },
          {
            id: "before-battle-damage-activation-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "beforeBattleDamage",
            triggerCode: 1136,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Before-battle-damage activation optional if resolved",
          },
          {
            id: "before-battle-damage-activation-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Before-battle-damage activation open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "before-battle-damage-activation-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial before-battle-damage effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "before-battle-damage-activation-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "before-battle-damage-activation-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "before-battle-damage-activation-open-fast", 1, 0)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if before-battle-damage triggers available while optional when before-battle-damage triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "before-battle-damage-activation-optional-if", eventName: "beforeBattleDamage", eventCode: 1136, eventCardUid: "p0-deck-700-4", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-700-4", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            eventHistory: [
              {},
              {},
              {},
              {
                eventName: "beforeBattleDamage",
                eventCode: 1136,
                eventCardUid: "p0-deck-700-4",
                eventPlayer: 1,
                eventValue: 1800,
                eventReason: 0x20,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-700-4",
              },
              {},
            ],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "before-battle-damage-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-open-fast" },
            ],
            logIncludes: ["Before-battle-damage activation multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "before-battle-damage-activation-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if before-battle-damage trigger activation restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "before-battle-damage-activation-optional-if", eventName: "beforeBattleDamage", eventCode: 1136, eventCardUid: "p0-deck-700-4", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-700-4", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "before-battle-damage-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "before-battle-damage-activation-open-fast" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if before-battle-damage trigger and returns to open fast priority",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "before-battle-damage-activation-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-optional-if" },
            ],
            logIncludes: ["Before-battle-damage activation multi step resolved", "Before-battle-damage activation optional if resolved"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the before-battle-damage optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "before-battle-damage-activation-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "before-battle-damage-activation-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "before-battle-damage-activation-optional-if" },
        ],
        logIncludes: ["Before-battle-damage activation multi step resolved", "Before-battle-damage activation optional if resolved"],
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
