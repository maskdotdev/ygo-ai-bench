import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-activating missed timing decline fixture", () => {
  it("returns declined optional if chain-activating triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Activating Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Chain Activating Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Chain Activating Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Chain Activating Open Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain-activating missed timing decline open fast fixture",
      options: { seed: 358, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "700", "800"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "chain-activating-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainActivating",
            triggerCode: 1021,
            triggerTiming: "when",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-activating decline optional when should not resolve",
          },
          {
            id: "chain-activating-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainActivating",
            triggerCode: 1021,
            triggerTiming: "if",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-activating decline optional if should not resolve",
          },
          {
            id: "chain-activating-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Chain-activating decline open fast resolved",
          },
        ],
        collectEvents: [
          {
            collectEvent: "chainActivating",
            eventCard: { player: 0, code: "100", location: "hand" },
            eventCode: 1021,
            eventIsLast: false,
            eventReasonPlayer: 0,
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "chain-activating-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro offers the optional if EVENT_CHAIN_ACTIVATING trigger for decline while optional when has missed timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{
              player: 0,
              effectId: "chain-activating-decline-optional-if",
              eventName: "chainActivating",
              eventCode: 1021,
              eventCardUid: "p0-deck-100-0",
              eventReason: 1024,
              eventReasonPlayer: 0,
              eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
              eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
              eventTriggerTiming: "if",
            }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-activating-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-activating-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-activating-decline-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "chain-activating-decline-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-activating-decline-optional-when" }],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-activating-decline-optional-when", "turnOptional", 0, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-activating-decline-open-fast", 0, "triggerBucket"),
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if EVENT_CHAIN_ACTIVATING trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "chain-activating-decline-open-fast", 1, 1)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-activating-decline-optional-when", "turnOptional", 1, "open"),
              absentTriggerActivationGroup(0, "chain-activating-decline-optional-if", "turnOptional", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state exposes open fast effects after declining the EVENT_CHAIN_ACTIVATING optional if trigger while optional when remains missed",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "chain-activating-decline-open-fast", 1, 1)],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-activating-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "chain-activating-decline-optional-when", "turnOptional", 1, "open"),
          absentTriggerActivationGroup(0, "chain-activating-decline-optional-if", "turnOptional", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
