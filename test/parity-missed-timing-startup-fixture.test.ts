import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity startup missed timing fixture", () => {
  it("resolves optional if startup triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "400", name: "Startup Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Startup Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "startup missed timing activation fixture",
      options: { seed: 391, startingHandSize: 3 },
      decks: {
        0: { main: ["400", "500", "700"] },
        1: { main: ["700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "startup-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "startup",
            triggerCode: 1000,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Startup optional when should not resolve",
          },
          {
            id: "startup-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "startup",
            triggerCode: 1000,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Startup optional if resolved",
          },
        ],
        collectEvents: [{ collectEvent: "startup", eventCode: 1000, eventIsLast: false }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "startup-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps optional if EVENT_STARTUP triggers available while optional when triggers miss timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "startup-optional-if", eventName: "startup", eventCode: 1000, eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "startup-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "startup-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "startup-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "startup-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "startup-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "startup-optional-when", "turnOptional", 0, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if startup trigger without resurrecting the missed optional when trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "normalSummon", player: 0, code: "700", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "700", location: "hand" },
              ], 1, 1),
              turnGroup(1),
            ],
            logIncludes: ["Startup optional if resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps optional when startup missed after the optional if trigger resolves",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "normalSummon", player: 0, code: "700", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "700", location: "hand" },
          ], 1, 1),
          turnGroup(1),
        ],
        logIncludes: ["Startup optional if resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
