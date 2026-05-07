import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff opponent response turn response chain resolution fixture", () => {
  it("resolves after the opponent chains from the open fast-effect turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Handoff Opponent Turn Chain Resolution Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Handoff Opponent Turn Chain Resolution First Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Handoff Opponent Turn Chain Resolution Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Open Handoff Opponent Turn Chain Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Open Handoff Opponent Turn Chain Resolution Second Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Open Handoff Opponent Turn Chain Resolution Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass handoff opponent response turn response chain resolution fixture",
      options: { seed: 348, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "500"] },
        1: { main: ["300", "600", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff opponent turn chain resolution open quick resolved",
          },
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-first-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn chain resolution first turn chain quick resolved",
          },
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-opponent-first-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn chain resolution opponent first chain quick resolved",
          },
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff opponent turn chain resolution opponent open quick should not resolve",
          },
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-second-turn-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn chain resolution second turn chain quick resolved",
          },
          {
            id: "open-fast-handoff-opponent-turn-chain-resolution-opponent-second-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn chain resolution opponent second chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-chain-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-chain-resolution-first-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-handoff-opponent-turn-chain-resolution-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-chain-resolution-second-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-handoff-opponent-turn-chain-resolution-opponent-second-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves open fast-effect handoff chains after the opponent chains from the response window reopened by the turn player's answer",
        phase: "main1",
        windowId: 6,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 6, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 6, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 6, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 6, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 6, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 6, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
          ], 1, 6),
          turnGroup(6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-first-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-second-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "open", effectId: "open-fast-handoff-opponent-turn-chain-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-handoff-opponent-turn-chain-resolution-open-quick", 6, "open"),
          absentWindowEffectGroup(0, "open-fast-handoff-opponent-turn-chain-resolution-first-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(0, "open-fast-handoff-opponent-turn-chain-resolution-second-turn-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "open-fast-handoff-opponent-turn-chain-resolution-opponent-first-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "open-fast-handoff-opponent-turn-chain-resolution-opponent-second-chain-quick", 6, "open"),
          absentWindowEffectGroup(1, "open-fast-handoff-opponent-turn-chain-resolution-opponent-open-quick", 6, "open"),
        ],
        logIncludes: [
          "Open fast handoff opponent turn chain resolution opponent second chain quick resolved",
          "Open fast handoff opponent turn chain resolution second turn chain quick resolved",
          "Open fast handoff opponent turn chain resolution opponent first chain quick resolved",
          "Open fast handoff opponent turn chain resolution first turn chain quick resolved",
          "Open fast handoff opponent turn chain resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
