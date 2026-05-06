import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

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
});
