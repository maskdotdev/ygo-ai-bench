import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Tribute-Set open fast-effect pass handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers a post-Tribute-Set pass-handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Tribute Set Handoff Opponent Turn Response Chain Tribute Set", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Post Tribute Set Handoff Opponent Turn Response Chain Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Tribute Set Handoff Opponent Turn Response Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Tribute Set Handoff Opponent Turn Response Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Tribute Set Handoff Opponent Turn Response Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Tribute Set Handoff Opponent Turn Response Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Post Tribute Set Handoff Opponent Turn Response Chain Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Tribute Set Handoff Opponent Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post tribute set open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 478, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "600"] },
        1: { main: ["400", "500", "800", "900"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
          { player: 1, code: "800", from: "hand", to: "graveyard" },
          { player: 1, code: "900", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain turn open quick should not resolve yet",
          },
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain turn chain quick should not resolve yet",
          },
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain opponent first chain quick should not resolve yet",
          },
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain opponent second chain quick should not resolve yet",
          },
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick",
            player: 1,
            code: "800",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain opponent third chain quick should not resolve yet",
          },
          {
            id: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "900",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Tribute Set handoff opponent turn response chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSet", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the turn player answers a post-Tribute-Set response window reopened by an opponent pass-handoff response",
        phase: "main1",
        windowId: 6,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-open-quick", sourceUid: "p0-deck-300-2" },
          { player: 1, effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-400-0" },
          { player: 1, effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", sourceUid: "p1-deck-500-1" },
          { player: 0, effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-chain-quick", sourceUid: "p0-deck-600-3" },
        ],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["200", "300", "600", "400", "500", "800", "900"] },
        cards: [
          { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "post-tribute-set-handoff-opponent-turn-response-chain-opponent-third-chain-quick", 1, 6),
          chainPassGroup(1, 1, 6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-tribute-set-handoff-opponent-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "post-tribute-set-handoff-opponent-turn-response-chain-turn-open-quick", 6, "chainResponse"),
          absentChainEffectGroup(0, "post-tribute-set-handoff-opponent-turn-response-chain-turn-chain-quick", 6),
          absentChainEffectGroup(1, "post-tribute-set-handoff-opponent-turn-response-chain-opponent-first-chain-quick", 6),
          absentChainEffectGroup(1, "post-tribute-set-handoff-opponent-turn-response-chain-opponent-second-chain-quick", 6),
          absentWindowEffectGroup(1, "post-tribute-set-handoff-opponent-turn-response-chain-opponent-open-quick", 6, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
