import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chainEnded open fast-effect pass-handoff chain resolution fixture", () => {
  it("resolves post-chainEnded open fast-effect pass-handoff chains after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Ended Handoff Resolution Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Handoff Resolution Chain Solved Blocker", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Handoff Resolution Chain Ended Cleanup", kind: "monster", attack: 1500, defense: 1600 },
      { code: "400", name: "Handoff Resolution Open Quick", kind: "monster", attack: 1200, defense: 1200 },
      { code: "500", name: "Handoff Resolution Opponent Chain Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "600", name: "Handoff Resolution Turn Chain Quick", kind: "monster", attack: 1300, defense: 1300 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "deferred chain ended open fast pass handoff chain resolution fixture",
      options: { seed: 618, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "400", "600"] },
        1: { main: ["500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "fixture-chain-ended-handoff-resolution-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            logMessage: "Chain ended handoff resolution starter resolved",
          },
          {
            id: "fixture-chain-ended-handoff-resolution-solved-blocker",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            range: ["hand"],
            logMessage: "Chain ended handoff resolution solved blocker should not resolve",
          },
          {
            id: "fixture-chain-ended-handoff-resolution-cleanup",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainEnded",
            optional: false,
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [
              { player: 0, code: "200", from: "hand", to: "graveyard" },
              { player: 0, code: "600", from: "graveyard", to: "hand" },
              { player: 1, code: "500", from: "graveyard", to: "hand" },
            ],
            logMessage: "Chain ended handoff resolution cleanup resolved",
          },
          {
            id: "fixture-chain-ended-handoff-resolution-open-fast-turn",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Chain ended handoff resolution open fast turn resolved",
          },
          {
            id: "fixture-chain-ended-handoff-resolution-opponent-chain",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff resolution opponent chain should not resolve",
          },
          {
            id: "fixture-chain-ended-handoff-resolution-turn-chain",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff resolution turn chain resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-resolution-starter" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-chain-ended-handoff-resolution-solved-blocker" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-chain-ended-handoff-resolution-cleanup" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-resolution-open-fast-turn" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-resolution-turn-chain" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), { snapshotRestore: "both" }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves a post-chainEnded open fast-effect pass-handoff chain after the opponent passes the turn player's handoff chain link",
        phase: "main1",
        windowId: 7,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        locations: { graveyard: ["200"], hand: ["100", "300", "400", "500", "600"] },
        legalActionCounts: { 0: 11, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "fixture-chain-ended-handoff-resolution-starter", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "600", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "600", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 7, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 7, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 7,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "fixture-chain-ended-handoff-resolution-starter", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "normalSummon", player: 0, code: "600", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "600", location: "hand" },
          ], 1, 7),
          turnGroup(7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "fixture-chain-ended-handoff-resolution-open-fast-turn" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "fixture-chain-ended-handoff-resolution-turn-chain" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "fixture-chain-ended-handoff-resolution-opponent-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-chain-ended-handoff-resolution-open-fast-turn", 7, "open"),
          absentWindowEffectGroup(0, "fixture-chain-ended-handoff-resolution-turn-chain", 7, "open"),
          absentWindowEffectGroup(1, "fixture-chain-ended-handoff-resolution-opponent-chain", 7, "open"),
        ],
        logIncludes: [
          "Chain ended handoff resolution starter resolved",
          "fixture-chain-ended-handoff-resolution-solved-blocker",
          "Chain ended handoff resolution cleanup resolved",
          "Chain ended handoff resolution turn chain resolved",
          "Chain ended handoff resolution open fast turn resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
