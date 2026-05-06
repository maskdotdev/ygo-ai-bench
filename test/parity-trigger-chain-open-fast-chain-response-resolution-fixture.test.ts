import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect chain response resolution fixture", () => {
  it("resolves opponent responses to selected triggers after the trigger player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Chain Response Resolution Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Chain Response Resolution Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Chain Response Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Chain Response Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Chain Response Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast chain response resolution fixture",
      options: { seed: 313, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "600", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-response-resolution-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger chain response resolution success resolved",
          },
          {
            id: "trigger-chain-response-resolution-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain response resolution turn chain quick should not resolve",
          },
          {
            id: "trigger-chain-response-resolution-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain response resolution opponent chain quick resolved",
          },
          {
            id: "trigger-chain-response-resolution-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Trigger chain response resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-response-resolution-success" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-response-resolution-opponent-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves a selected trigger chain after the trigger player passes on the opponent's chain response",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "trigger-chain-response-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "trigger-chain-response-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "trigger-chain-response-resolution-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "trigger-chain-response-resolution-turn-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "trigger-chain-response-resolution-opponent-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "trigger-chain-response-resolution-opponent-open-quick", 4, "open"),
        ],
        logIncludes: [
          "Trigger chain response resolution opponent chain quick resolved",
          "Trigger chain response resolution success resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
