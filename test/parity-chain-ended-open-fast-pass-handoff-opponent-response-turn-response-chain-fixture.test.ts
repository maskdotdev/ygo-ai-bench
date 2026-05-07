import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chainEnded open fast-effect handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers a post-chainEnded handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Ended Handoff Turn Response Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Chain Ended Handoff Turn Response Solved Blocker", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Chain Ended Handoff Turn Response Cleanup", kind: "monster", attack: 1500, defense: 1600 },
      { code: "400", name: "Chain Ended Handoff Turn Response Open Quick", kind: "monster", attack: 1200, defense: 1200 },
      { code: "500", name: "Chain Ended Handoff Turn Response First Turn Chain", kind: "monster", attack: 1300, defense: 1300 },
      { code: "600", name: "Chain Ended Handoff Turn Response Opponent First Chain", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Chain Ended Handoff Turn Response Second Turn Chain", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Chain Ended Handoff Turn Response Opponent Second Chain", kind: "monster", attack: 800, defense: 800 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "deferred chain ended open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 622, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "200", "300", "400", "500", "700"] },
        1: { main: ["600", "800"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "500", from: "hand", to: "graveyard" },
          { player: 0, code: "700", from: "hand", to: "graveyard" },
          { player: 1, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "800", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "fixture-chain-ended-handoff-turn-response-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            logMessage: "Chain ended handoff turn response starter resolved",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-solved-blocker",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            range: ["hand"],
            logMessage: "Chain ended handoff turn response solved blocker should not resolve",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-cleanup",
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
              { player: 0, code: "500", from: "graveyard", to: "hand" },
              { player: 0, code: "700", from: "graveyard", to: "hand" },
              { player: 1, code: "600", from: "graveyard", to: "hand" },
              { player: 1, code: "800", from: "graveyard", to: "hand" },
            ],
            logMessage: "Chain ended handoff turn response cleanup resolved",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-open-fast",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Chain ended handoff turn response open fast should not resolve yet",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-first-turn-chain",
            player: 0,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff turn response first turn chain should not resolve yet",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-second-turn-chain",
            player: 0,
            code: "700",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff turn response second turn chain should not resolve yet",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-opponent-first-chain",
            player: 1,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff turn response opponent first chain should not resolve yet",
          },
          {
            id: "fixture-chain-ended-handoff-turn-response-opponent-second-chain",
            player: 1,
            code: "800",
            location: "graveyard",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Chain ended handoff turn response opponent second chain should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-turn-response-starter" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-chain-ended-handoff-turn-response-solved-blocker" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-chain-ended-handoff-turn-response-cleanup" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-turn-response-open-fast" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-turn-response-first-turn-chain" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-chain-ended-handoff-turn-response-opponent-first-chain" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-chain-ended-handoff-turn-response-second-turn-chain" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent responses after the turn player answers a post-chainEnded pass-handoff response",
        phase: "main1",
        windowId: 8,
        windowKind: "chainResponse",
        waitingFor: 1,
        chain: [
          { player: 0, effectId: "fixture-chain-ended-handoff-turn-response-open-fast", sourceUid: "p0-deck-400-3" },
          { player: 0, effectId: "fixture-chain-ended-handoff-turn-response-first-turn-chain", sourceUid: "p0-deck-500-4" },
          { player: 1, effectId: "fixture-chain-ended-handoff-turn-response-opponent-first-chain", sourceUid: "p1-deck-600-0" },
          { player: 0, effectId: "fixture-chain-ended-handoff-turn-response-second-turn-chain", sourceUid: "p0-deck-700-5" },
        ],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        locations: { graveyard: ["200"], hand: ["100", "300", "400", "500", "700", "600", "800"] },
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-chain-ended-handoff-turn-response-opponent-second-chain", count: 1 },
          { type: "passChain", player: 1, windowId: 8, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-chain-ended-handoff-turn-response-opponent-second-chain", 1, 8),
          chainPassGroup(1, 1, 8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-chain-ended-handoff-turn-response-open-fast" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-chain-ended-handoff-turn-response-first-turn-chain" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-chain-ended-handoff-turn-response-second-turn-chain" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-chain-ended-handoff-turn-response-opponent-first-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-chain-ended-handoff-turn-response-open-fast", 8, "chainResponse"),
          absentChainEffectGroup(0, "fixture-chain-ended-handoff-turn-response-first-turn-chain", 8),
          absentChainEffectGroup(0, "fixture-chain-ended-handoff-turn-response-second-turn-chain", 8),
          absentChainEffectGroup(1, "fixture-chain-ended-handoff-turn-response-opponent-first-chain", 8),
        ],
        logIncludes: [
          "Chain ended handoff turn response starter resolved",
          "fixture-chain-ended-handoff-turn-response-solved-blocker",
          "Chain ended handoff turn response cleanup resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
