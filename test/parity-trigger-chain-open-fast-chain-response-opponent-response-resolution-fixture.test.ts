import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect chain response opponent response resolution fixture", () => {
  it("resolves opponent responses to trigger-player chain responses after the trigger player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Chain Opponent Response Resolution Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Chain Opponent Response Resolution Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Chain Opponent Response Resolution First Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Chain Opponent Response Resolution Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Chain Opponent Response Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Trigger Chain Opponent Response Resolution Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Trigger Chain Opponent Response Resolution Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Trigger Chain Opponent Response Resolution Second Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast chain response opponent response resolution fixture",
      options: { seed: 317, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "900"] },
        1: { main: ["500", "800", "600", "700"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-opponent-response-resolution-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger chain opponent response resolution success resolved",
          },
          {
            id: "trigger-chain-opponent-response-resolution-first-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain opponent response resolution first turn chain quick resolved",
          },
          {
            id: "trigger-chain-opponent-response-resolution-opponent-first-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain opponent response resolution opponent first chain quick resolved",
          },
          {
            id: "trigger-chain-opponent-response-resolution-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Trigger chain opponent response resolution opponent open quick should not resolve",
          },
          {
            id: "trigger-chain-opponent-response-resolution-opponent-second-chain-quick",
            player: 1,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain opponent response resolution opponent second chain quick resolved",
          },
          {
            id: "trigger-chain-opponent-response-resolution-second-turn-chain-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain opponent response resolution second turn chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-opponent-response-resolution-success" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-opponent-response-resolution-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-chain-opponent-response-resolution-first-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-opponent-response-resolution-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored trigger-player priority before passing the response window reopened by the opponent's second response",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-chain-opponent-response-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "trigger-chain-opponent-response-resolution-opponent-first-chain-quick", sourceUid: "p1-deck-500-0" },
              { player: 0, effectId: "trigger-chain-opponent-response-resolution-first-turn-chain-quick", sourceUid: "p0-deck-300-2" },
              { player: 1, effectId: "trigger-chain-opponent-response-resolution-opponent-second-chain-quick", sourceUid: "p1-deck-800-1" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-chain-opponent-response-resolution-second-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-chain-opponent-response-resolution-second-turn-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "trigger-chain-opponent-response-resolution-first-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-chain-opponent-response-resolution-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-chain-opponent-response-resolution-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "trigger-chain-opponent-response-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-chain-opponent-response-resolution-first-turn-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-first-chain-quick", 5),
              absentChainEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-second-chain-quick", 5),
              absentWindowEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-open-quick", 5, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the selected trigger chain after the trigger player passes the response window reopened by the opponent's response",
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
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "trigger-chain-opponent-response-resolution-first-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "trigger-chain-opponent-response-resolution-second-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "trigger-chain-opponent-response-resolution-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "trigger-chain-opponent-response-resolution-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "trigger-chain-opponent-response-resolution-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "trigger-chain-opponent-response-resolution-first-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(0, "trigger-chain-opponent-response-resolution-second-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-first-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-second-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "trigger-chain-opponent-response-resolution-opponent-open-quick", 6, "open"),
        ],
        logIncludes: [
          "Trigger chain opponent response resolution opponent second chain quick resolved",
          "Trigger chain opponent response resolution first turn chain quick resolved",
          "Trigger chain opponent response resolution opponent first chain quick resolved",
          "Trigger chain opponent response resolution success resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
