import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity phase open priority fixtures", () => {
  it("returns phase changes to turn-player open priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick After Phase", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Opponent Open Quick After Phase", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Phase Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "phase open fast effect fixture",
      options: { seed: 265, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        effects: [
          {
            id: "phase-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Turn open quick after phase resolved",
          },
          {
            id: "phase-opponent-open-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open quick after phase should not be offered",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns phase changes to turn-player open priority without handing priority to the opponent",
            windowId: 1,
            windowKind: "open",
            phase: "battle",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-opponent-open-quick" },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open priority after entering Battle Phase",
        windowId: 1,
        windowKind: "open",
        phase: "battle",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(1)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-opponent-open-quick" },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("returns end turn handoff to the new turn player's open priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Old Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "New Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "New Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end turn open fast effect handoff fixture",
      options: { seed: 266, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        effects: [
          {
            id: "phase-old-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Old turn open quick should not be offered",
          },
          {
            id: "phase-new-turn-open-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "New turn open quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro hands priority to the next turn player after End Phase cleanup and exposes that player's open fast effects",
            windowId: 1,
            windowKind: "open",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            chain: [],
            legalActionCounts: { 0: 0, 1: 7 },
            legalActionGroupCounts: { 0: 0, 1: 3 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-new-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
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
                actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-new-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 1, code: "200", location: "hand" },
                { type: "normalSummon", player: 1, code: "300", location: "hand" },
                { type: "setMonster", player: 1, code: "200", location: "hand" },
                { type: "setMonster", player: 1, code: "300", location: "hand" },
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
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps the new turn player's open priority after ending the turn",
        windowId: 1,
        windowKind: "open",
        phase: "main1",
        turnPlayer: 1,
        turn: 2,
        waitingFor: 1,
        pendingTriggers: [],
        chain: [],
        legalActionCounts: { 0: 0, 1: 7 },
        legalActionGroupCounts: { 0: 0, 1: 3 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-new-turn-open-quick", count: 1 },
          { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
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
            actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-new-turn-open-quick", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 1, code: "200", location: "hand" },
            { type: "normalSummon", player: 1, code: "300", location: "hand" },
            { type: "setMonster", player: 1, code: "200", location: "hand" },
            { type: "setMonster", player: 1, code: "300", location: "hand" },
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
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 1,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-old-turn-open-quick" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
