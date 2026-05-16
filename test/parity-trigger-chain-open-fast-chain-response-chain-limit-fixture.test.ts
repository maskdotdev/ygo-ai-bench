import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain response chain-limit fixture", () => {
  it("applies one-chain limits after the opponent responds to a selected trigger", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Chain Limit Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Chain Limit Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Chain Limit Turn Followup", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Trigger Chain Limit Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Chain Limit Opponent Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Chain Limit Opponent Blocked", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Trigger Chain Limit Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast chain response chain limit fixture",
      options: { seed: 614, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "400"] },
        1: { main: ["500", "600", "700", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-limit-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger chain limit success resolved",
          },
          {
            id: "trigger-chain-limit-turn-followup",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Trigger chain limit turn followup should not resolve",
          },
          {
            id: "trigger-chain-limit-turn-open",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Trigger chain limit turn open quick should not resolve",
          },
          {
            id: "trigger-chain-limit-opponent-limiter",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Trigger chain limit opponent limiter resolved",
          },
          {
            id: "trigger-chain-limit-opponent-blocked",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Trigger chain limit opponent blocked should not resolve",
          },
          {
            id: "trigger-chain-limit-opponent-open",
            player: 1,
            code: "700",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Trigger chain limit opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-limit-success" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-limit-opponent-limiter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent priority before the opponent selects the one-chain SetChainLimit response",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "trigger-chain-limit-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-limiter", count: 1 },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-blocked", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-limiter", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-blocked", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-turn-followup" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-turn-open" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-open" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-chain-limit-turn-followup", 2),
              absentWindowEffectGroup(0, "trigger-chain-limit-turn-open", 2, "chainResponse"),
              absentWindowEffectGroup(1, "trigger-chain-limit-opponent-open", 2, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after the opponent responds to a selected trigger chain",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-chain-limit-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 1, effectId: "trigger-chain-limit-opponent-limiter" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-chain-limit-turn-followup", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-turn-open" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-limiter" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-blocked" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-open" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-chain-limit-turn-open", 3),
              absentChainEffectGroup(1, "trigger-chain-limit-opponent-limiter", 3),
              absentChainEffectGroup(1, "trigger-chain-limit-opponent-blocked", 3),
              absentChainEffectGroup(1, "trigger-chain-limit-opponent-open", 3),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the selected-trigger SetChainLimit response window restorable before the allowed trigger player passes",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [
              { player: 0, effectId: "trigger-chain-limit-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 1, effectId: "trigger-chain-limit-opponent-limiter" },
            ],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-chain-limit-turn-followup", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-limit-opponent-blocked" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-chain-limit-opponent-blocked", 3)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and returns selected trigger chains to turn-player open priority after the allowed player passes",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        chainLimits: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-turn-open", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 4,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-turn-open", count: 1 }],
          },
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-turn-followup" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-opponent-limiter" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-opponent-blocked" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "trigger-chain-limit-opponent-open" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "trigger-chain-limit-turn-followup", 4, "open"),
          absentWindowEffectGroup(1, "trigger-chain-limit-opponent-limiter", 4, "open"),
          absentWindowEffectGroup(1, "trigger-chain-limit-opponent-blocked", 4, "open"),
          absentWindowEffectGroup(1, "trigger-chain-limit-opponent-open", 4, "open"),
        ],
        logIncludes: [
          "Trigger chain limit opponent limiter resolved",
          "Trigger chain limit success resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
