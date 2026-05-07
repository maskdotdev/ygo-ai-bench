import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity end turn open fast-effect pass handoff chain fixture", () => {
  it("opens previous-turn responses after the new turn player chains from the returned handoff window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Previous Turn Handoff Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Next Turn Handoff Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Previous Turn Handoff Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Next Turn Handoff Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end turn open fast pass handoff chain fixture",
      options: { seed: 270, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["200", "500"] },
      },
      setup: {
        effects: [
          {
            id: "end-turn-handoff-chain-previous-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Previous turn handoff chain open quick should not be offered",
          },
          {
            id: "end-turn-handoff-chain-next-open-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Next turn handoff chain open quick should not resolve yet",
          },
          {
            id: "end-turn-handoff-chain-previous-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Previous turn handoff chain quick should not resolve yet",
          },
          {
            id: "end-turn-handoff-chain-next-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Next turn handoff chain quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens the next turn player's open fast-effect window after End Turn",
            windowId: 1,
            windowKind: "open",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 7 },
            legalActionGroupCounts: { 0: 0, 1: 3 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-chain-next-open-quick", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "changePhase", player: 1, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-chain-next-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 1, code: "200", location: "hand" },
                { type: "normalSummon", player: 1, code: "500", location: "hand" },
                { type: "setMonster", player: 1, code: "200", location: "hand" },
                { type: "setMonster", player: 1, code: "500", location: "hand" },
              ], 1, 1),
              {
                player: 1,
                label: "Turn",
                windowId: 1,
                windowKind: "open",
                actions: [
                  { type: "changePhase", player: 1, windowId: 1, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 1, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-chain-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-chain-previous-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-chain-next-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-open-quick", 1, "open"),
              absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "end-turn-handoff-chain-next-chain-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "end-turn-handoff-chain-next-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "end-turn-handoff-chain-next-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores the new turn player's returned response window after the previous turn player passes the turn-handoff open fast-effect chain",
            windowId: 3,
            windowKind: "chainResponse",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 1, effectId: "end-turn-handoff-chain-next-open-quick", sourceUid: "p1-deck-200-0" }],
            chainPasses: [0],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "end-turn-handoff-chain-next-chain-quick", 1, 3),
              chainPassGroup(1, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-open-quick", 3, "chainResponse"),
              absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-chain-quick", 3, "chainResponse"),
              absentWindowEffectGroup(1, "end-turn-handoff-chain-next-open-quick", 3, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro opens restored previous-turn response priority after the new turn player chains from the returned turn-handoff response window",
            windowId: 4,
            windowKind: "chainResponse",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 1, effectId: "end-turn-handoff-chain-next-open-quick", sourceUid: "p1-deck-200-0" },
              { player: 1, effectId: "end-turn-handoff-chain-next-chain-quick", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "end-turn-handoff-chain-previous-chain-quick", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-open-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-open-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-open-quick", 4, "chainResponse"),
              absentWindowEffectGroup(1, "end-turn-handoff-chain-next-open-quick", 4, "chainResponse"),
              absentWindowEffectGroup(1, "end-turn-handoff-chain-next-chain-quick", 4, "chainResponse"),
            ],
            logIncludes: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens previous-turn response priority after the new turn player chains from the returned turn-handoff response window",
        windowId: 4,
        windowKind: "chainResponse",
        phase: "main1",
        turnPlayer: 1,
        turn: 2,
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 1, effectId: "end-turn-handoff-chain-next-open-quick", sourceUid: "p1-deck-200-0" },
          { player: 1, effectId: "end-turn-handoff-chain-next-chain-quick", sourceUid: "p1-deck-500-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-chain-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "end-turn-handoff-chain-previous-chain-quick", 1, 4),
          chainPassGroup(0, 1, 4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-previous-open-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-open-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "end-turn-handoff-chain-next-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "end-turn-handoff-chain-previous-open-quick", 4, "chainResponse"),
          absentWindowEffectGroup(1, "end-turn-handoff-chain-next-open-quick", 4, "chainResponse"),
          absentWindowEffectGroup(1, "end-turn-handoff-chain-next-chain-quick", 4, "chainResponse"),
        ],
        logIncludes: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
