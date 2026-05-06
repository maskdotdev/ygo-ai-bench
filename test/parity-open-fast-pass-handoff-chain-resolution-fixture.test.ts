import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff chain resolution fixture", () => {
  it("resolves turn-player chains from open fast-effect pass handoff after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Handoff Resolution Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Handoff Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Handoff Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Open Handoff Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass handoff chain resolution fixture",
      options: { seed: 302, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: ["300", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-handoff-resolution-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff resolution turn open quick resolved",
          },
          {
            id: "open-fast-handoff-resolution-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff resolution turn chain quick resolved",
          },
          {
            id: "open-fast-handoff-resolution-opponent-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff resolution opponent chain quick should not resolve",
          },
          {
            id: "open-fast-handoff-resolution-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-resolution-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-resolution-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves an open fast-effect chain after the opponent passes the turn player's pass-handoff chain link",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
          ], 1, 4),
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-fast-handoff-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-fast-handoff-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "open-fast-handoff-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-handoff-resolution-turn-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "open-fast-handoff-resolution-turn-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "open-fast-handoff-resolution-opponent-open-quick", 4, "open"),
        ],
        logIncludes: [
          "Open fast handoff resolution turn chain quick resolved",
          "Open fast handoff resolution turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
