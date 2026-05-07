import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff fixture", () => {
  it("returns chain response priority to the turn player after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast effect pass handoff fixture",
      options: { seed: 262, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "500"] },
      },
      setup: {
        effects: [
          {
            id: "pass-handoff-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Pass handoff turn open quick resolved",
          },
          {
            id: "pass-handoff-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass handoff turn chain quick resolved",
          },
          {
            id: "pass-handoff-opponent-chain-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Pass handoff opponent chain quick resolved",
          },
          {
            id: "pass-handoff-opponent-open-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Pass handoff opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "pass-handoff-turn-open-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes turn-player open fast effects without exposing chain-only quick effects before a chain starts",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pass-handoff-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pass-handoff-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first response priority after an open fast effect starts a chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "pass-handoff-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "pass-handoff-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "pass-handoff-opponent-open-quick", 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent response priority before an opponent pass hands priority back",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "pass-handoff-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "pass-handoff-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "pass-handoff-opponent-open-quick", 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns chain-response priority to the turn player after the opponent passes with a response available",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "pass-handoff-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "pass-handoff-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "chainResponse",
                actions: [
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick" },
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player response priority before both players pass the open fast-effect chain",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "pass-handoff-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "pass-handoff-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "chainResponse",
                actions: [
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-chain-quick" },
                  { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "pass-handoff-opponent-open-quick" },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the open fast-effect chain after both players pass chain-response priority",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 3),
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "pass-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                actions: [
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-open-quick" },
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" },
                ],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "pass-handoff-opponent-open-quick" }],
              },
            ],
            logIncludes: ["Pass handoff turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns to turn-player open priority after both players pass the open fast-effect chain",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "pass-handoff-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            actions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "pass-handoff-turn-chain-quick" },
            ],
          },
          {
            player: 1,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "pass-handoff-opponent-open-quick" }],
          },
        ],
        logIncludes: ["Pass handoff turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
