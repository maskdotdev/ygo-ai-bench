import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect no-response fixture", () => {
  it("auto-resolves an open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Turn Open Quick Pass", kind: "monster", attack: 1000, defense: 1000 },
      { code: "310", name: "Turn Normal Pass Follow-up", kind: "monster", attack: 1000, defense: 1000 },
      { code: "410", name: "Opponent Pass Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast effect no-response priority fixture",
      options: { seed: 263, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "310"] },
        1: { main: ["410", "410"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-turn-open-pass-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open pass quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-open-pass-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes turn-player open fast effects beside Main Phase actions before a no-response chain starts",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-open-pass-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "310", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "310", location: "hand", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-open-pass-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "310", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "310", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves an open fast-effect chain immediately when the opponent has no legal fast-effect response",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "310", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "310", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "310", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "310", location: "hand" },
              ], 1, 1),
              turnGroup(1),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "fixture-turn-open-pass-quick" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "fixture-turn-open-pass-quick" }],
              },
            ],
            logIncludes: ["Turn open pass quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response open fast-effect chain",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "310", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "310", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "310", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "310", location: "hand" },
          ], 1, 1),
          turnGroup(1),
        ],
        absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "fixture-turn-open-pass-quick" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 1,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "fixture-turn-open-pass-quick" }],
          },
        ],
        logIncludes: ["Turn open pass quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
