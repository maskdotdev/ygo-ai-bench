import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-negated missed timing fixture", () => {
  it("resolves optional if chain-negated triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Negated Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Chain Negated Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Chain Negated Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain-negated missed timing activation fixture",
      options: { seed: 365, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400", "500", "700"] },
        1: { main: ["700", "700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "chain-negated-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainNegated",
            triggerCode: 1024,
            triggerTiming: "when",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-negated optional when should not resolve",
          },
          {
            id: "chain-negated-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainNegated",
            triggerCode: 1024,
            triggerTiming: "if",
            eventCardCode: "100",
            range: ["hand"],
            logMessage: "Chain-negated optional if resolved",
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
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "chain-negated-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps optional if EVENT_CHAIN_NEGATED triggers available while optional when triggers miss timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "chain-negated-optional-if",
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
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "chain-negated-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "chain-negated-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "chain-negated-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "chain-negated-optional-when", "turnOptional", 0, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if EVENT_CHAIN_NEGATED trigger without resurrecting the missed optional when trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "normalSummon", player: 0, code: "700", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "700", location: "hand" },
              ], 1, 1),
              turnGroup(1),
            ],
            logIncludes: ["Chain-negated optional if resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps optional when EVENT_CHAIN_NEGATED missed after the optional if trigger resolves",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 10, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "normalSummon", player: 0, code: "700", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "700", location: "hand" },
          ], 1, 1),
          turnGroup(1),
        ],
        logIncludes: ["Chain-negated optional if resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
