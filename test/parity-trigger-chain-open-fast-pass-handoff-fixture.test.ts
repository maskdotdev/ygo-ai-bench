import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, triggerActivationGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect pass handoff fixture", () => {
  it("returns trigger-chain response priority to the trigger player after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain pass handoff fixture",
      options: { seed: 264, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "500", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-pass-handoff-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Pass handoff trigger resolved",
          },
          {
            id: "trigger-pass-handoff-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Pass handoff trigger turn chain quick resolved",
          },
          {
            id: "trigger-pass-handoff-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Pass handoff trigger opponent chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-pass-handoff-success" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the restored summon-success trigger bucket before activation",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 0, effectId: "trigger-pass-handoff-success", eventName: "normalSummoned", triggerBucket: "turnMandatory", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-pass-handoff-success", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(0, "trigger-pass-handoff-success", "turnMandatory", 1, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first response priority after the summon-success trigger is selected",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "trigger-pass-handoff-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "trigger-pass-handoff-opponent-chain-quick", 1, 2), chainPassGroup(1, 1, 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent priority before the opponent passes the trigger-chain response window",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "trigger-pass-handoff-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "trigger-pass-handoff-opponent-chain-quick", 1, 2), chainPassGroup(1, 1, 2)],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns trigger-chain response priority to the trigger player after the opponent passes with a response available",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "trigger-pass-handoff-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-handoff-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "trigger-pass-handoff-turn-chain-quick", 1, 3), chainPassGroup(0, 1, 3)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-chain-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-pass-handoff-opponent-chain-quick", 3)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps the trigger chain pending after the opponent passes and the trigger player has a chain response",
        windowId: 3,
        windowKind: "chainResponse",
        waitingFor: 0,
        chain: [{ player: 0, effectId: "trigger-pass-handoff-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
        chainPasses: [1],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-handoff-turn-chain-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [chainEffectGroup(0, "trigger-pass-handoff-turn-chain-quick", 1, 3), chainPassGroup(0, 1, 3)],
        absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-chain-quick" }],
        absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-pass-handoff-opponent-chain-quick", 3)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
