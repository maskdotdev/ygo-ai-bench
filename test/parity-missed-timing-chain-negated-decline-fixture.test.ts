import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-negated missed timing decline fixture", () => {
  it("returns declined optional if chain-negated triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Negated Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Chain Negated Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Chain Negated Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Chain Negated Open Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain-negated missed timing decline open fast fixture",
      options: { seed: 366, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "700", "800"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "chain-negated-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainNegated",
            triggerCode: 1024,
            triggerTiming: "when",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-negated decline optional when should not resolve",
          },
          {
            id: "chain-negated-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainNegated",
            triggerCode: 1024,
            triggerTiming: "if",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-negated decline optional if should not resolve",
          },
          {
            id: "chain-negated-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Chain-negated decline open fast resolved",
          },
        ],
        collectEvents: [
          {
            collectEvent: "chainNegated",
            eventCard: { player: 0, code: "100", location: "hand" },
            eventCode: 1024,
            eventIsLast: false,
            eventPlayer: 0,
            eventValue: 1,
            eventReason: 0x40,
            eventReasonPlayer: 0,
            relatedEffectId: 1,
            eventChainDepth: 1,
            eventChainLinkId: "fixture-chain-1",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "chain-negated-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro offers the optional if EVENT_CHAIN_NEGATED trigger for decline while optional when has missed timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "chain-negated-decline-optional-if",
                eventName: "chainNegated",
                eventCode: 1024,
                eventCardUid: "p0-deck-100-0",
                eventPlayer: 0,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                relatedEffectId: 1,
                eventChainDepth: 1,
                eventChainLinkId: "fixture-chain-1",
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-negated-decline-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "chain-negated-decline-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-decline-optional-when" }],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-when", "turnOptional", 0, "triggerBucket"),
              absentWindowEffectGroup(0, "chain-negated-decline-open-fast", 0, "triggerBucket"),
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if EVENT_CHAIN_NEGATED trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "chain-negated-decline-open-fast", 1, 1)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-when", "turnOptional", 1, "open"),
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-if", "turnOptional", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "chain-negated-decline-open-fast" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the chain-negated post-decline open fast-effect window restorable after missed-timing filtering",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "chain-negated-decline-open-fast", 1, 1)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "open", effectId: "chain-negated-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-when", "turnOptional", 1, "open"),
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-if", "turnOptional", 1, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored post-decline open fast effect without resurrecting missed optional when triggers for chain-negated events",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "chain-negated-decline-open-fast", 1, 2)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "chain-negated-decline-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Chain-negated decline open fast resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the restored chain-negated post-decline open fast effect while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "chain-negated-decline-open-fast", 1, 2)],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "chain-negated-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "chain-negated-decline-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "chain-negated-decline-optional-if", "turnOptional", 2, "open"),
        ],
        logIncludes: ["Chain-negated decline open fast resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
