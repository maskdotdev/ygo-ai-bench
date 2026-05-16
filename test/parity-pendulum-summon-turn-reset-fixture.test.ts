import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Pendulum Summon turn reset fixtures", () => {
  it("removes same-turn Pendulum Summon actions and restores them on the player's next turn", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Low Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1, attack: 1000, defense: 1000 },
      { code: "200", name: "High Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8, attack: 1000, defense: 1000 },
      { code: "300", name: "First Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1500, defense: 1500 },
      { code: "400", name: "Second Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 5, attack: 1500, defense: 1500 },
      { code: "500", name: "Normal Follow-up Monster", kind: "monster", level: 4, attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "pendulum summon turn reset fixture",
      options: { seed: 254, startingHandSize: 5, drawPerTurn: 0 },
      decks: {
        0: { main: ["100", "200", "300", "400", "500"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "200", from: "hand", to: "spellTrapZone" },
        ],
      },
      responses: [
        makeScriptedStep({ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"], label: "Pendulum Summon selected first candidate" }, {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes one Pendulum Summon action per turn with all currently legal Pendulum candidates",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            turn: 1,
            turnPlayer: 0,
            phase: "main1",
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2", "p0-deck-400-3"], windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "normalSummon", player: 0, code: "300", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "setMonster", player: 0, code: "300", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "normalSummon", player: 0, code: "500", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "setMonster", player: 0, code: "500", location: "hand", windowId: 0, windowKind: "open", count: 1 },
                  { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2", "p0-deck-400-3"], windowId: 0, windowKind: "open", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
                ],
              },
            ],
            locations: { spellTrapZone: ["100", "200"], hand: ["300", "400", "500"] },
          },
          after: {
            source: "edopro",
            note: "EDOPro consumes the once-per-turn Pendulum Summon after it resolves, even if other candidates remain legal",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, code: "500", location: "hand", windowId: 1, windowKind: "open", count: 1 },
              { type: "setMonster", player: 0, code: "500", location: "hand", windowId: 1, windowKind: "open", count: 1 },
              { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 1, windowKind: "open", count: 1 },
              { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
                { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
                { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
              ], 1, 1),
              turnGroup(1),
            ],
            absentLegalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 1, windowKind: "open" }],
              },
            ],
            locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps Pendulum Summon consumed and unavailable before ending the summoning player's turn",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            turn: 1,
            turnPlayer: 0,
            phase: "main1",
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, code: "500", location: "hand", windowId: 1, windowKind: "open", count: 1 },
              { type: "setMonster", player: 0, code: "500", location: "hand", windowId: 1, windowKind: "open", count: 1 },
              { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 1, windowKind: "open", count: 1 },
              { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
                { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
                { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
              ], 1, 1),
              turnGroup(1),
            ],
            absentLegalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 1, windowKind: "open" }],
            locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },

            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 1,
                windowKind: "open",
                actions: [
                  { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 1, windowKind: "open" },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the original player's Pendulum Summon unavailable while the opponent's turn begins",
            windowId: 2,
            windowKind: "open",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            phase: "main1",
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                actions: [
                  { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 2, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 2, windowKind: "open" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the original player's Pendulum Summon unavailable through the opponent's open turn window",
            windowId: 2,
            windowKind: "open",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            phase: "main1",
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                actions: [
                  { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 2, windowKind: "open" }],

            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 2,
                windowKind: "open",
                actions: [
                  { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 2, windowKind: "open" },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro restores Pendulum Summon availability when the original player's next turn starts",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            turn: 3,
            turnPlayer: 0,
            phase: "main1",
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 3, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [{ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 3, windowKind: "open", count: 1 }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state restores Pendulum Summon availability on the player's next turn",
        turn: 3,
        turnPlayer: 0,
        phase: "main1",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], hand: ["400", "500"] },
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "changePosition", player: 0, code: "300", location: "monsterZone", position: "faceUpDefense", windowId: 3, windowKind: "open", count: 1 },
          { type: "normalSummon", player: 0, code: "500", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "setMonster", player: 0, code: "500", location: "hand", windowId: 3, windowKind: "open", count: 1 },
          { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 3, windowKind: "open", count: 1 },
          { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"], windowId: 3, windowKind: "open", count: 1 },
          { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"], windowId: 3, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Actions",
            windowId: 3,
            windowKind: "open",
            count: 1,
            actions: [{ type: "changePosition", player: 0, code: "300", location: "monsterZone", position: "faceUpDefense", windowId: 3, windowKind: "open", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
            { type: "tributeSummon", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
            { type: "tributeSet", player: 0, code: "400", location: "hand", tributeUids: ["p0-deck-300-2"] },
            { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-400-3"] },
          ], 1, 3),
          turnGroup(3),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
