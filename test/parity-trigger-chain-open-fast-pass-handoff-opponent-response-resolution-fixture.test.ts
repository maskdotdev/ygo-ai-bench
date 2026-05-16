import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect pass handoff opponent response resolution fixture", () => {
  it("resolves opponent responses to pass-handoff chains after the trigger player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Pass Handoff Opponent Response Resolution Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Pass Handoff Opponent Response Resolution Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Pass Handoff Opponent Response Resolution First Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Pass Handoff Opponent Response Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Pass Handoff Opponent Response Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Trigger Pass Handoff Opponent Response Resolution Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Trigger Pass Handoff Opponent Response Resolution Second Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast pass handoff opponent response resolution fixture",
      options: { seed: 320, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "900"] },
        1: { main: ["500", "600", "700", "700"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-pass-handoff-opponent-response-resolution-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger pass handoff opponent response resolution success resolved",
          },
          {
            id: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger pass handoff opponent response resolution first turn chain quick resolved",
          },
          {
            id: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger pass handoff opponent response resolution opponent chain quick resolved",
          },
          {
            id: "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Trigger pass handoff opponent response resolution opponent open quick should not resolve",
          },
          {
            id: "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger pass handoff opponent response resolution second turn chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-pass-handoff-opponent-response-resolution-success" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent priority before the opponent responds to the trigger pass-handoff chain",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", sourceUid: "p0-deck-300-2" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", 1, 4),
              chainPassGroup(1, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", 4),
              absentChainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", 4),
              absentWindowEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick", 4, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns trigger-chain response priority to the trigger player after the opponent responds to a pass-handoff chain",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", sourceUid: "p0-deck-300-2" },
              { player: 1, effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", sourceUid: "p1-deck-500-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick", 5),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored trigger-player priority before the trigger player passes the opponent-reopened response window",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 0, effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", sourceUid: "p0-deck-300-2" },
              { player: 1, effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", sourceUid: "p1-deck-500-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick", 5),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the trigger pass-handoff chain after the trigger player passes the response window reopened by the opponent's response",
        windowId: 6,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 6, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 6, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(6)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-first-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(0, "trigger-pass-handoff-opponent-response-resolution-second-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "trigger-pass-handoff-opponent-response-resolution-opponent-open-quick", 6, "open"),
        ],
        logIncludes: [
          "Trigger pass handoff opponent response resolution opponent chain quick resolved",
          "Trigger pass handoff opponent response resolution first turn chain quick resolved",
          "Trigger pass handoff opponent response resolution success resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
