import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentSummonGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Flip Summon open fast-effect chain fixture", () => {
  it("opens opponent chain responses after a triggerless Flip Summon open fast effect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Flip Chain Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Flip Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Flip Chain Response", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Flip Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "flip summon open fast chain-response fixture",
      options: { seed: 363, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "flip-summon-turn-open-chain-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open quick after Flip Summon chain resolved",
          },
          {
            id: "flip-summon-opponent-chain-response-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain quick after Flip Summon should not resolve",
          },
          {
            id: "flip-summon-opponent-open-chain-filtered",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Flip Summon chain should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Flip Summon actions beside turn-player open fast effects before the Flip Summon is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "flip-summon-turn-open-chain-quick", count: 1 },
              { type: "flipSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "monsterZone", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "flip-summon-turn-open-chain-quick", count: 1 }],
              },
              summonGroup([{ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "flip-summon-opponent-chain-response-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "flip-summon-opponent-open-chain-filtered" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "flip-summon-opponent-chain-response-quick", 0, "open"),
              absentWindowEffectGroup(1, "flip-summon-opponent-open-chain-filtered", 0, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "flip-summon-turn-open-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves post-Flip-Summon turn-player open priority before a fast effect starts a chain",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-chain-quick", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-chain-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "flipSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "monsterZone" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "flip-summon-opponent-chain-response-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "flip-summon-opponent-open-chain-filtered" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 1),
              absentWindowEffectGroup(1, "flip-summon-opponent-chain-response-quick", 1, "open"),
              absentWindowEffectGroup(1, "flip-summon-opponent-open-chain-filtered", 1, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent chain-response priority after a post-Flip-Summon open fast effect starts a chain",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "flip-summon-turn-open-chain-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "flip-summon-opponent-chain-response-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "flip-summon-opponent-chain-response-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "flip-summon-opponent-open-chain-filtered" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "flip-summon-opponent-open-chain-filtered", 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent chain-response priority before passing the post-Flip-Summon fast-effect chain",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "flip-summon-turn-open-chain-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "flip-summon-opponent-chain-response-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "flip-summon-opponent-chain-response-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "flip-summon-opponent-open-chain-filtered" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "flip-summon-opponent-open-chain-filtered", 2)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps turn-player open priority after resolving a post-Flip-Summon open fast-effect chain",
        phase: "main1",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        absentLegalActions: [
          { type: "flipSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "monsterZone" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "flip-summon-turn-open-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "flip-summon-opponent-chain-response-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "flip-summon-opponent-open-chain-filtered" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 3),
          absentWindowEffectGroup(0, "flip-summon-turn-open-chain-quick", 3, "open"),
          absentWindowEffectGroup(1, "flip-summon-opponent-chain-response-quick", 3, "open"),
          absentWindowEffectGroup(1, "flip-summon-opponent-open-chain-filtered", 3, "open"),
        ],
        logIncludes: ["Turn open quick after Flip Summon chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
