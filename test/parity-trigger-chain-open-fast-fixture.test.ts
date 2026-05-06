import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { chainPassGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect fixtures", () => {
  it("returns trigger chain resolution to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Open Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast effect fixture",
      options: { seed: 262, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "400"] },
        1: { main: ["500", "400", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Summon success trigger resolved",
          },
          {
            id: "trigger-chain-turn-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Turn open quick after trigger resolved",
          },
          {
            id: "trigger-chain-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Opponent chain quick after trigger should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro opens the summon-success trigger bucket before open fast effects after a Normal Summon",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "trigger-chain-success", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-success", count: 1 }],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-opponent-chain-quick" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-success" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent the first fast-effect response to a selected summon-success trigger chain",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "trigger-chain-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-opponent-chain-quick", count: 1 }],
              },
              chainPassGroup(1, 1, 2),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro returns resolved trigger chains to turn-player open priority with open fast effects available",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "trigger-chain-turn-open-quick", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "trigger-chain-turn-open-quick", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-chain-quick" },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand" },
            ],
            logIncludes: ["Summon success trigger resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after the summon-success trigger chain resolves",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        logIncludes: ["Summon success trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
