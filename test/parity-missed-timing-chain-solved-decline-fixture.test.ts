import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-solved missed timing decline fixture", () => {
  it("declines optional if chain-solved triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Solved Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Chain Solved Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Chain Solved Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain-solved missed timing decline fixture",
      options: { seed: 364, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400", "500", "700"] },
        1: { main: ["700", "700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "chain-solved-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            triggerCode: 1022,
            triggerTiming: "when",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-solved decline optional when should not resolve",
          },
          {
            id: "chain-solved-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            triggerCode: 1022,
            triggerTiming: "if",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-solved decline optional if should not resolve",
          },
        ],
        collectEvents: [
          {
            collectEvent: "chainSolved",
            eventCard: { player: 0, code: "100", location: "hand" },
            eventCode: 1022,
            eventIsLast: false,
            eventPlayer: 0,
            eventValue: 1,
            eventReasonPlayer: 0,
            eventChainDepth: 1,
            eventChainLinkId: "fixture-chain-1",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "chain-solved-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro offers the optional if EVENT_CHAIN_SOLVED trigger for decline while optional when has missed timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "chain-solved-decline-optional-if",
                eventName: "chainSolved",
                eventCode: 1022,
                eventPlayer: 0,
                eventValue: 1,
                eventReasonPlayer: 0,
                eventChainDepth: 1,
                eventChainLinkId: "fixture-chain-1",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-solved-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-solved-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-solved-decline-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "chain-solved-decline-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-solved-decline-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "chain-solved-decline-optional-when", "turnOptional", 0, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro clears the declined optional if EVENT_CHAIN_SOLVED trigger without reviving the missed optional when trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps optional when EVENT_CHAIN_SOLVED missed after the optional if trigger is declined",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
