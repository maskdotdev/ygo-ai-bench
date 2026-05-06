import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect chain-response pass handoff fixture", () => {
  it("returns response priority to the opponent after the turn player passes an opponent chain link", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Chain Pass Handoff Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Chain Pass Handoff Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Chain Pass Handoff Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Open Chain Pass Handoff Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Open Chain Pass Handoff Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast chain response pass handoff fixture",
      options: { seed: 304, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "100"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-chain-pass-handoff-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain pass handoff turn open quick should not resolve yet",
          },
          {
            id: "open-fast-chain-pass-handoff-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain pass handoff turn chain quick should not resolve",
          },
          {
            id: "open-fast-chain-pass-handoff-opponent-first-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain pass handoff opponent first chain quick should not resolve yet",
          },
          {
            id: "open-fast-chain-pass-handoff-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain pass handoff opponent second chain quick should not resolve yet",
          },
          {
            id: "open-fast-chain-pass-handoff-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain pass handoff opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-pass-handoff-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-pass-handoff-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns response priority to the opponent after the turn player passes an opponent chain link when another opponent chain response is legal",
        phase: "main1",
        windowId: 3,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "open-fast-chain-pass-handoff-turn-open-quick", sourceUid: "p0-deck-100-0" },
          { player: 1, effectId: "open-fast-chain-pass-handoff-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
        ],
        chainPasses: [0],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-pass-handoff-opponent-second-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "open-fast-chain-pass-handoff-opponent-second-chain-quick", 1, 3),
          chainPassGroup(1, 1, 3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-pass-handoff-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-pass-handoff-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-pass-handoff-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(0, "open-fast-chain-pass-handoff-turn-chain-quick", 3),
          absentChainEffectGroup(1, "open-fast-chain-pass-handoff-opponent-first-chain-quick", 3),
          absentWindowEffectGroup(1, "open-fast-chain-pass-handoff-opponent-open-quick", 3, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
