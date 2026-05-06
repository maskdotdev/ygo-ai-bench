import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity end turn open fast-effect pass handoff pass resolution fixture", () => {
  it("resolves turn-handoff open fast effects after the new turn player passes the returned response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Previous Turn Handoff Pass Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Next Turn Handoff Pass Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Previous Turn Handoff Pass Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Next Turn Handoff Pass Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end turn open fast pass handoff pass resolution fixture",
      options: { seed: 269, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["200", "500"] },
      },
      setup: {
        effects: [
          {
            id: "end-turn-handoff-pass-previous-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Previous turn handoff pass open quick should not be offered",
          },
          {
            id: "end-turn-handoff-pass-next-open-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Next turn handoff pass open quick resolved",
          },
          {
            id: "end-turn-handoff-pass-previous-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Previous turn handoff pass chain quick should not resolve",
          },
          {
            id: "end-turn-handoff-pass-next-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Next turn handoff pass chain quick should not resolve",
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
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-pass-next-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-pass-next-open-quick", count: 1 }],
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
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-pass-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-pass-previous-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-handoff-pass-next-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-open-quick", 1, "open"),
              absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "end-turn-handoff-pass-next-chain-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "end-turn-handoff-pass-next-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns chain-response priority to the new turn player after the previous turn player passes a turn-handoff open fast-effect chain",
            windowId: 3,
            windowKind: "chainResponse",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 1, effectId: "end-turn-handoff-pass-next-open-quick", sourceUid: "p1-deck-200-0" }],
            chainPasses: [0],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-pass-next-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "end-turn-handoff-pass-next-chain-quick", 1, 3),
              chainPassGroup(1, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-pass-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-pass-previous-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "end-turn-handoff-pass-next-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-open-quick", 3, "chainResponse"),
              absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-chain-quick", 3, "chainResponse"),
              absentWindowEffectGroup(1, "end-turn-handoff-pass-next-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the turn-handoff open fast-effect chain after both players pass the returned chain-response window",
        windowId: 4,
        windowKind: "open",
        phase: "main1",
        turnPlayer: 1,
        turn: 2,
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 6 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "normalSummon", player: 1, windowId: 4, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 1, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 4, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "changePhase", player: 1, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 1, code: "200", location: "hand" },
            { type: "normalSummon", player: 1, code: "500", location: "hand" },
            { type: "setMonster", player: 1, code: "200", location: "hand" },
            { type: "setMonster", player: 1, code: "500", location: "hand" },
          ], 1, 4),
          {
            player: 1,
            label: "Turn",
            windowId: 4,
            windowKind: "open",
            actions: [
              { type: "changePhase", player: 1, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 4, windowKind: "open", count: 1 },
            ],
          },
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "end-turn-handoff-pass-next-open-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "end-turn-handoff-pass-next-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "end-turn-handoff-pass-previous-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "end-turn-handoff-pass-previous-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "end-turn-handoff-pass-next-open-quick", 4, "open"),
          absentWindowEffectGroup(1, "end-turn-handoff-pass-next-chain-quick", 4, "open"),
          absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "end-turn-handoff-pass-previous-chain-quick", 4, "open"),
        ],
        logIncludes: ["Next turn handoff pass open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
