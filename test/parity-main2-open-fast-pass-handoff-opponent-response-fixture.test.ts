import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff opponent response fixture", () => {
  it("resolves opponent responses to turn-player chains from a Main Phase 2 pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Handoff Opponent Response Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Handoff Opponent Response Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Handoff Opponent Response Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Handoff Opponent Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast pass handoff opponent response fixture",
      options: { seed: 291, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "130"] },
        1: { main: ["210", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-handoff-opponent-response-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent response turn open quick resolved",
          },
          {
            id: "main2-handoff-opponent-response-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent response turn chain quick resolved",
          },
          {
            id: "main2-handoff-opponent-response-opponent-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent response opponent chain quick resolved",
          },
          {
            id: "main2-handoff-opponent-response-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-response-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-response-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-handoff-opponent-response-opponent-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the Main Phase 2 open fast-effect chain after the opponent responds to the turn player's pass-handoff chain link",
        phase: "main2",
        windowId: 6,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 6, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 6, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 6, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 6, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "130", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "130", location: "hand" },
          ], 1, 6),
          turnGroup(6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "main2-handoff-opponent-response-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "main2-handoff-opponent-response-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "main2-handoff-opponent-response-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "main2-handoff-opponent-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-handoff-opponent-response-turn-open-quick", 6, "open"),
          absentWindowEffectGroup(0, "main2-handoff-opponent-response-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-response-opponent-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-response-opponent-open-quick", 6, "open"),
        ],
        logIncludes: [
          "Main2 handoff opponent response opponent chain quick resolved",
          "Main2 handoff opponent response turn chain quick resolved",
          "Main2 handoff opponent response turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
