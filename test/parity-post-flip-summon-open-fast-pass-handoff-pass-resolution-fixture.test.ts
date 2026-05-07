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
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Flip-Summon open fast-effect pass handoff pass resolution fixture", () => {
  it("resolves a post-Flip-Summon open fast-effect chain when both players pass after the handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Flip Summon Pass Resolution Flippable Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Flip Summon Pass Resolution Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Flip Summon Pass Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Flip Summon Pass Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Flip Summon Pass Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post flip summon open fast pass handoff pass resolution fixture",
      options: { seed: 428, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "600"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-flip-summon-pass-resolution-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Flip Summon pass resolution turn open quick resolved",
          },
          {
            id: "post-flip-summon-pass-resolution-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Flip Summon pass resolution turn chain quick should not resolve",
          },
          {
            id: "post-flip-summon-pass-resolution-opponent-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Flip Summon pass resolution opponent chain quick should not resolve",
          },
          {
            id: "post-flip-summon-pass-resolution-opponent-open-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Post Flip Summon pass resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Flip Summons to turn-player open fast-effect priority before post-Flip-Summon handoff chains can begin",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["300", "600", "400", "500"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-flip-summon-pass-resolution-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-flip-summon-pass-resolution-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "flipSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "monsterZone" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-flip-summon-pass-resolution-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-flip-summon-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-flip-summon-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 1),
              absentWindowEffectGroup(0, "post-flip-summon-pass-resolution-turn-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-flip-summon-pass-resolution-opponent-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-flip-summon-pass-resolution-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-flip-summon-pass-resolution-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player chain-only responses after the opponent passes a post-Flip-Summon open fast-effect chain",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "post-flip-summon-pass-resolution-turn-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            locations: { monsterZone: ["100"], graveyard: ["300", "600", "400", "500"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-flip-summon-pass-resolution-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-flip-summon-pass-resolution-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-flip-summon-pass-resolution-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-flip-summon-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-flip-summon-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-flip-summon-pass-resolution-turn-open-quick", 3),
              absentChainEffectGroup(1, "post-flip-summon-pass-resolution-opponent-chain-quick", 3),
              absentWindowEffectGroup(1, "post-flip-summon-pass-resolution-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves post-Flip-Summon pass-handoff chains back to turn-player open priority when both players pass after the handoff",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["300", "600", "400", "500"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "flipSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "monsterZone" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-flip-summon-pass-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-flip-summon-pass-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-flip-summon-pass-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-flip-summon-pass-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 4),
          absentWindowEffectGroup(0, "post-flip-summon-pass-resolution-turn-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "post-flip-summon-pass-resolution-turn-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-flip-summon-pass-resolution-opponent-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-flip-summon-pass-resolution-opponent-open-quick", 4, "open"),
        ],
        logIncludes: ["Post Flip Summon pass resolution turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
