import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers an open fast-effect pass-handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Handoff Opponent Turn Response Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Handoff Opponent Turn Response Chain First Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Handoff Opponent Turn Response Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Open Handoff Opponent Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Open Handoff Opponent Turn Response Chain Second Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Open Handoff Opponent Turn Response Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 346, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "500"] },
        1: { main: ["300", "600", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-handoff-opponent-turn-response-chain-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff opponent turn response chain open quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-opponent-turn-response-chain-first-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn response chain first turn chain quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-opponent-turn-response-chain-opponent-first-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn response chain opponent first chain quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-opponent-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff opponent turn response chain opponent open quick should not resolve",
          },
          {
            id: "open-fast-handoff-opponent-turn-response-chain-second-turn-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn response chain second turn chain quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-opponent-turn-response-chain-opponent-second-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff opponent turn response chain opponent second chain quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-response-chain-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-response-chain-first-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-handoff-opponent-turn-response-chain-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-opponent-turn-response-chain-second-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the turn player answers an open fast-effect pass-handoff response",
        phase: "main1",
        windowId: 5,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "open-fast-handoff-opponent-turn-response-chain-open-quick", sourceUid: "p0-deck-100-0" },
          { player: 0, effectId: "open-fast-handoff-opponent-turn-response-chain-first-turn-chain-quick", sourceUid: "p0-deck-200-1" },
          { player: 1, effectId: "open-fast-handoff-opponent-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
          { player: 0, effectId: "open-fast-handoff-opponent-turn-response-chain-second-turn-chain-quick", sourceUid: "p0-deck-500-2" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-opponent-second-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "open-fast-handoff-opponent-turn-response-chain-opponent-second-chain-quick", 1, 5),
          chainPassGroup(1, 1, 5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-first-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-second-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "open-fast-handoff-opponent-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-handoff-opponent-turn-response-chain-open-quick", 5, "chainResponse"),
          absentChainEffectGroup(0, "open-fast-handoff-opponent-turn-response-chain-first-turn-chain-quick", 5),
          absentChainEffectGroup(0, "open-fast-handoff-opponent-turn-response-chain-second-turn-chain-quick", 5),
          absentChainEffectGroup(1, "open-fast-handoff-opponent-turn-response-chain-opponent-first-chain-quick", 5),
          absentWindowEffectGroup(1, "open-fast-handoff-opponent-turn-response-chain-opponent-open-quick", 5, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
