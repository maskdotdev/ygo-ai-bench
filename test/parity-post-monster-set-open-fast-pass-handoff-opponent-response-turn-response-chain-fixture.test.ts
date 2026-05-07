import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Monster-Set open fast-effect pass handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers a post-Monster-Set pass-handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Set Handoff Opponent Turn Response Chain Settable Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Set Handoff Opponent Turn Response Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Set Handoff Opponent Turn Response Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Post Set Handoff Opponent Turn Response Chain Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Set Handoff Opponent Turn Response Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Set Handoff Opponent Turn Response Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Post Set Handoff Opponent Turn Response Chain Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Set Handoff Opponent Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post monster set open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 410, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "600", "700"] },
        1: { main: ["400", "500", "800", "900"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
          { player: 1, code: "800", from: "hand", to: "graveyard" },
          { player: 1, code: "900", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain turn open quick should not resolve yet",
          },
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain turn chain quick should not resolve yet",
          },
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain opponent first chain quick should not resolve yet",
          },
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain opponent second chain quick should not resolve yet",
          },
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick",
            player: 1,
            code: "800",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain opponent third chain quick should not resolve yet",
          },
          {
            id: "post-monster-set-handoff-opponent-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "900",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Monster Set handoff opponent turn response chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setMonster", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player priority before chaining from the post-Monster-Set handoff response window",
            phase: "main1",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 1, effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-400-0" },
              { player: 1, effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick", 5, "chainResponse"),
              absentChainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", 5),
              absentChainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", 5),
              absentChainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick", 5),
              absentWindowEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-open-quick", 5, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the turn player answers a post-Monster-Set response window reopened by an opponent pass-handoff response",
        phase: "main1",
        windowId: 6,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick", sourceUid: "p0-deck-300-1" },
          { player: 1, effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-400-0" },
          { player: 1, effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", sourceUid: "p1-deck-500-1" },
          { player: 0, effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick", sourceUid: "p0-deck-600-2" },
        ],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["300", "600", "400", "500", "800", "900"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick", 1, 6),
          chainPassGroup(1, 1, 6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-monster-set-handoff-opponent-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "post-monster-set-handoff-opponent-turn-response-chain-turn-open-quick", 6, "chainResponse"),
          absentChainEffectGroup(0, "post-monster-set-handoff-opponent-turn-response-chain-turn-chain-quick", 6),
          absentChainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", 6),
          absentChainEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", 6),
          absentWindowEffectGroup(1, "post-monster-set-handoff-opponent-turn-response-chain-opponent-open-quick", 6, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
