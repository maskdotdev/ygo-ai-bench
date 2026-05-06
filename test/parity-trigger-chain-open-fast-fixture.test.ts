import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect fixtures", () => {
  it("returns trigger chain resolution to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Open Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Opponent Open Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast effect fixture",
      options: { seed: 262, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "400"] },
        1: { main: ["500", "600", "400", "400"] },
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
          {
            id: "trigger-chain-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open quick after trigger should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
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
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-turn-open-quick" }],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [
                  { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-opponent-chain-quick" },
                  { type: "activateEffect", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "trigger-chain-opponent-open-quick" },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-success" }), {
          snapshotRestore: "both",
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
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-opponent-open-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-chain-opponent-open-quick", 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
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
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-open-quick" },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                actions: [
                  { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-chain-quick" },
                  { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-open-quick" },
                ],
              },
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
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          {
            player: 1,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            actions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "trigger-chain-opponent-open-quick" },
            ],
          },
        ],
        logIncludes: ["Summon success trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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

  it("resolves trigger-player chain responses after opponent pass back to open priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain pass handoff resolution fixture",
      options: { seed: 265, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "500", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-pass-resolution-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Pass resolution trigger resolved",
          },
          {
            id: "trigger-pass-resolution-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass resolution turn chain quick resolved",
          },
          {
            id: "trigger-pass-resolution-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Pass resolution opponent chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-pass-resolution-success" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns trigger-chain response priority to the trigger player after the opponent passes with a response available",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "trigger-pass-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-resolution-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "trigger-pass-resolution-turn-chain-quick", 1, 3), chainPassGroup(0, 1, 3)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-resolution-opponent-chain-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-pass-resolution-opponent-chain-quick", 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-pass-resolution-turn-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent another chain-response window after the trigger player chains from pass handoff",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [
              { player: 0, effectId: "trigger-pass-resolution-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "trigger-pass-resolution-turn-chain-quick", sourceUid: "p0-deck-300-2" },
            ],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-resolution-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "trigger-pass-resolution-opponent-chain-quick", 1, 4), chainPassGroup(1, 1, 4)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the trigger pass-handoff chain after the opponent passes on the new chain link",
            windowId: 5,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(5)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-resolution-turn-chain-quick" },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 5,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-resolution-turn-chain-quick" }],
              },
            ],
            logIncludes: ["Pass resolution turn chain quick resolved", "Pass resolution trigger resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns to turn-player open priority after the trigger pass-handoff chain resolves",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-resolution-turn-chain-quick" },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-resolution-turn-chain-quick" }],
          },
        ],
        logIncludes: ["Pass resolution turn chain quick resolved", "Pass resolution trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("resolves opponent chain responses after trigger-player pass handoff chains", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain pass handoff opponent response fixture",
      options: { seed: 266, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "500", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-pass-opponent-response-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            optional: false,
            range: ["hand"],
            logMessage: "Pass opponent response trigger resolved",
          },
          {
            id: "trigger-pass-opponent-response-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass opponent response turn chain quick resolved",
          },
          {
            id: "trigger-pass-opponent-response-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass opponent response opponent chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-pass-opponent-response-success" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-pass-opponent-response-turn-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent another chain-response window after the trigger player chains from pass handoff",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [
              { player: 0, effectId: "trigger-pass-opponent-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "trigger-pass-opponent-response-turn-chain-quick", sourceUid: "p0-deck-300-2" },
            ],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "trigger-pass-opponent-response-opponent-chain-quick", 1, 4), chainPassGroup(1, 1, 4)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-pass-opponent-response-opponent-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the trigger pass-handoff chain after the opponent adds the only remaining response",
            windowId: 5,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(5)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 5,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" }],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 5,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" }],
              },
            ],
            logIncludes: [
              "Pass opponent response opponent chain quick resolved",
              "Pass opponent response turn chain quick resolved",
              "Pass opponent response trigger resolved",
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns to turn-player open priority after the opponent responds to the trigger pass-handoff chain",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" }],
          },
          {
            player: 1,
            label: "Effects",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" }],
          },
        ],
        logIncludes: [
          "Pass opponent response opponent chain quick resolved",
          "Pass opponent response turn chain quick resolved",
          "Pass opponent response trigger resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
