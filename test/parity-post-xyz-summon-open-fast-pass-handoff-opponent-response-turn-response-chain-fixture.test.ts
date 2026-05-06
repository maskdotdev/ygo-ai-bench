import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Xyz-Summon open fast-effect pass handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers a post-Xyz-Summon pass-handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Xyz Handoff Opponent Turn Response Chain Material A", kind: "monster", level: 4, attack: 1000, defense: 1000 },
      { code: "200", name: "Post Xyz Handoff Opponent Turn Response Chain Material B", kind: "monster", level: 4, attack: 1000, defense: 1000 },
      { code: "300", name: "Post Xyz Handoff Opponent Turn Response Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Xyz Handoff Opponent Turn Response Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Post Xyz Handoff Opponent Turn Response Chain Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Xyz Handoff Opponent Turn Response Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Xyz Handoff Opponent Turn Response Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Post Xyz Handoff Opponent Turn Response Chain Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "950", name: "Post Xyz Handoff Opponent Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Xyz Handoff Opponent Turn Response Chain Rank Four Xyz", kind: "extra", typeFlags: 0x800001, level: 4, attack: 2000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post xyz summon open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 455, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "600", "700"], extra: ["900"] },
        1: { main: ["400", "500", "800", "950"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 0, code: "700", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
          { player: 1, code: "800", from: "hand", to: "graveyard" },
          { player: 1, code: "950", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain turn open quick should not resolve yet",
          },
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain turn chain quick should not resolve yet",
          },
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-first-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain opponent first chain quick should not resolve yet",
          },
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain opponent second chain quick should not resolve yet",
          },
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-third-chain-quick",
            player: 1,
            code: "800",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain opponent third chain quick should not resolve yet",
          },
          {
            id: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "950",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Xyz Summon handoff opponent turn response chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("xyzSummon", 0, { code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"] })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the turn player answers a post-Xyz-Summon response window reopened by an opponent pass-handoff response",
        phase: "main1",
        windowId: 6,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-open-quick", sourceUid: "p0-deck-300-2" },
          { player: 1, effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-400-0" },
          { player: 1, effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-second-chain-quick", sourceUid: "p1-deck-500-1" },
          { player: 0, effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-chain-quick", sourceUid: "p0-deck-600-3" },
        ],
        chainPasses: [],
        locations: { monsterZone: ["900"], overlay: ["100", "200"], graveyard: ["300", "600", "700", "400", "500", "800", "950"] },
        cards: [
          { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true, overlayCount: 2 },
          { uid: "p0-deck-100-0", code: "100", location: "overlay" },
          { uid: "p0-deck-200-1", code: "200", location: "overlay" },
        ],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-third-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-third-chain-quick", 1, 6),
          chainPassGroup(1, 1, 6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "post-xyz-summon-handoff-opponent-turn-response-chain-turn-open-quick", 6, "chainResponse"),
          absentChainEffectGroup(0, "post-xyz-summon-handoff-opponent-turn-response-chain-turn-chain-quick", 6),
          absentChainEffectGroup(1, "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-first-chain-quick", 6),
          absentChainEffectGroup(1, "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-second-chain-quick", 6),
          absentWindowEffectGroup(1, "post-xyz-summon-handoff-opponent-turn-response-chain-opponent-open-quick", 6, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
