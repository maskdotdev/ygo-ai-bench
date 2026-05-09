import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity phase-start-main1 missed timing decline fixture", () => {
  it("declines optional if phase-start-main1 triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "400", name: "Phase Start Main1 Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Phase Start Main1 Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "phase-start-main1 missed timing decline fixture",
      options: { seed: 380, startingHandSize: 3 },
      decks: {
        0: { main: ["400", "500", "700"] },
        1: { main: ["700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "phase-start-main1-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseStartMain1",
            triggerCode: 0x2004,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Phase-start-main1 decline optional when should not resolve",
          },
          {
            id: "phase-start-main1-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseStartMain1",
            triggerCode: 0x2004,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Phase-start-main1 decline optional if should not resolve",
          },
        ],
        collectEvents: [{ collectEvent: "phaseStartMain1", eventCode: 0x2004, eventIsLast: false }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "phase-start-main1-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro offers the optional if EVENT_PHASE_START+PHASE_MAIN1 trigger for decline while optional when has missed timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "phase-start-main1-decline-optional-if", eventName: "phaseStartMain1", eventCode: 0x2004 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-start-main1-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-start-main1-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "phase-start-main1-decline-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "phase-start-main1-decline-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-start-main1-decline-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "phase-start-main1-decline-optional-when", "turnOptional", 0, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro clears the declined optional if phase-start-main1 trigger without reviving the missed optional when trigger",
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
        note: "EDOPro final state keeps optional when phase-start-main1 missed after the optional if trigger is declined",
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
