import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity phase-standby missed timing decline fixture", () => {
  it("returns declined optional if phase-standby triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "400", name: "Phase Standby Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Phase Standby Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Phase Standby Open Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "phase-standby missed timing decline open fast fixture",
      options: { seed: 378, startingHandSize: 4 },
      decks: {
        0: { main: ["400", "500", "700", "800"] },
        1: { main: ["700", "700", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "phase-standby-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseStandby",
            triggerCode: 0x1002,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Phase-standby decline optional when should not resolve",
          },
          {
            id: "phase-standby-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseStandby",
            triggerCode: 0x1002,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Phase-standby decline optional if should not resolve",
          },
          {
            id: "phase-standby-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Phase-standby decline open fast resolved",
          },
        ],
        collectEvents: [{ collectEvent: "phaseStandby", eventCode: 0x1002, eventIsLast: false }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "phase-standby-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro offers the optional if EVENT_PHASE+PHASE_STANDBY trigger for decline while optional when has missed timing",
            windowId: 0,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "phase-standby-decline-optional-if", eventName: "phaseStandby", eventCode: 0x1002 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-standby-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-standby-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "phase-standby-decline-optional-if", "turnOptional", 1, 0),
              triggerDeclineGroup(0, "phase-standby-decline-optional-if", "turnOptional", 1, 0),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 0, windowKind: "triggerBucket", effectId: "phase-standby-decline-optional-when" }],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "phase-standby-decline-optional-when", "turnOptional", 0, "triggerBucket"),
              absentWindowEffectGroup(0, "phase-standby-decline-open-fast", 0, "triggerBucket"),
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if phase-standby trigger",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-standby-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "phase-standby-decline-open-fast", 1, 1)],
            legalActionCounts: { 0: 11, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "phase-standby-decline-optional-when", "turnOptional", 1, "open"),
              absentTriggerActivationGroup(0, "phase-standby-decline-optional-if", "turnOptional", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state exposes open fast effects after declining the phase-standby optional if trigger while optional when remains missed",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-standby-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "phase-standby-decline-open-fast", 1, 1)],
        legalActionCounts: { 0: 11, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "phase-standby-decline-optional-when", "turnOptional", 1, "open"),
          absentTriggerActivationGroup(0, "phase-standby-decline-optional-if", "turnOptional", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
