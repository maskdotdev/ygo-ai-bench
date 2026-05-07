import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect chain-response pass handoff chain resolution fixture", () => {
  it("resolves opponent chains from chain-response pass handoff after the turn player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Chain Handoff Resolution Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Chain Handoff Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Chain Handoff Resolution Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Open Chain Handoff Resolution Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Open Chain Handoff Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Open Chain Handoff Resolution Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast chain response pass handoff chain resolution fixture",
      options: { seed: 306, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "700"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-chain-handoff-resolution-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain handoff resolution turn open quick resolved",
          },
          {
            id: "open-fast-chain-handoff-resolution-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff resolution turn chain quick should not resolve",
          },
          {
            id: "open-fast-chain-handoff-resolution-opponent-first-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff resolution opponent first chain quick resolved",
          },
          {
            id: "open-fast-chain-handoff-resolution-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff resolution opponent second chain quick resolved",
          },
          {
            id: "open-fast-chain-handoff-resolution-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain handoff resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-handoff-resolution-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-handoff-resolution-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-handoff-resolution-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast-effect chain after the turn player passes the opponent's chain-response handoff chain link",
            phase: "main1",
            windowId: 5,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "700", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "700", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "700", location: "hand" },
              ], 1, 5),
              turnGroup(5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-chain-handoff-resolution-turn-open-quick", 5, "open"),
              absentWindowEffectGroup(0, "open-fast-chain-handoff-resolution-turn-chain-quick", 5, "open"),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-resolution-opponent-open-quick", 5, "open"),
            ],
            logIncludes: [
              "Open fast chain handoff resolution opponent second chain quick resolved",
              "Open fast chain handoff resolution opponent first chain quick resolved",
              "Open fast chain handoff resolution turn open quick resolved",
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the open fast-effect chain after the turn player passes the opponent's chain-response pass-handoff chain link",
        phase: "main1",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "700", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "normalSummon", player: 0, code: "700", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "700", location: "hand" },
          ], 1, 5),
          turnGroup(5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "open-fast-chain-handoff-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-chain-handoff-resolution-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "open-fast-chain-handoff-resolution-turn-chain-quick", 5, "open"),
          absentWindowEffectGroup(1, "open-fast-chain-handoff-resolution-opponent-open-quick", 5, "open"),
        ],
        logIncludes: [
          "Open fast chain handoff resolution opponent second chain quick resolved",
          "Open fast chain handoff resolution opponent first chain quick resolved",
          "Open fast chain handoff resolution turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
