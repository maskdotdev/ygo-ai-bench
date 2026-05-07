import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect no-response fixture", () => {
  it("auto-resolves a Main Phase 2 open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 No Response Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "120", name: "Main2 No Response Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 No Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast effect no-response fixture",
      options: { seed: 284, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "120"] },
        1: { main: ["220", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-no-response-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 no response turn open quick resolved",
          },
          {
            id: "main2-no-response-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Main2 no response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps Main Phase 2 active and resolves an open fast-effect chain immediately when the opponent has no legal fast-effect response",
            phase: "main2",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "120", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "120", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "120", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "120", location: "hand" },
              ], 1, 3),
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "main2-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "main2-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-no-response-turn-open-quick", 3, "open"),
              absentWindowEffectGroup(1, "main2-no-response-opponent-open-quick", 3, "open"),
            ],
            logIncludes: ["Main2 no response turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and resolves an open fast-effect chain immediately when the opponent has no legal fast-effect response",
        phase: "main2",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "120", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "120", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "120", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "120", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "main2-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "main2-no-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-no-response-turn-open-quick", 3, "open"),
          absentWindowEffectGroup(1, "main2-no-response-opponent-open-quick", 3, "open"),
        ],
        logIncludes: ["Main2 no response turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
