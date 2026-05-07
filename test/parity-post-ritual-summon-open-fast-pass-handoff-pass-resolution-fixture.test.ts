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

describe("EDOPro parity post-Ritual-Summon open fast-effect pass handoff pass resolution fixture", () => {
  it("resolves a post-Ritual-Summon open fast-effect chain when both players pass after the handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Ritual Summon Pass Resolution Material A", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Post Ritual Summon Pass Resolution Material B", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Ritual Summon Pass Resolution Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Ritual Summon Pass Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Ritual Summon Pass Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Ritual Summon Pass Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Ritual Summon Pass Resolution Ritual Monster", kind: "monster", ritualMaterials: ["100", "200"], attack: 2000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post ritual summon open fast pass handoff pass resolution fixture",
      options: { seed: 465, startingHandSize: 5 },
      decks: {
        0: { main: ["900", "100", "200", "300", "600"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-ritual-summon-pass-resolution-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Ritual Summon pass resolution turn open quick resolved",
          },
          {
            id: "post-ritual-summon-pass-resolution-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Ritual Summon pass resolution turn chain quick should not resolve",
          },
          {
            id: "post-ritual-summon-pass-resolution-opponent-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Ritual Summon pass resolution opponent chain quick should not resolve",
          },
          {
            id: "post-ritual-summon-pass-resolution-opponent-open-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Post Ritual Summon pass resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("ritualSummon", 0, { code: "900", location: "hand", materialUids: ["p0-deck-100-1", "p0-deck-200-2"] }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Ritual Summons to turn-player open fast-effect priority before post-Ritual-Summon handoff chains can begin",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
            cards: [
              { uid: "p0-deck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-1", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-2", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "ritualSummon", player: 0, windowId: 1, windowKind: "open", code: "900", location: "hand" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "ritualSummon", player: 0, code: "900", location: "hand" }, 1),
              absentWindowEffectGroup(0, "post-ritual-summon-pass-resolution-turn-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-ritual-summon-pass-resolution-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player chain-only responses after the opponent passes a post-Ritual-Summon open fast-effect chain",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "post-ritual-summon-pass-resolution-turn-open-quick", sourceUid: "p0-deck-300-3" }],
            chainPasses: [1],
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
            cards: [
              { uid: "p0-deck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-1", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-2", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-ritual-summon-pass-resolution-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-ritual-summon-pass-resolution-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-ritual-summon-pass-resolution-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-ritual-summon-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-ritual-summon-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-ritual-summon-pass-resolution-turn-open-quick", 3),
              absentChainEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-chain-quick", 3),
              absentWindowEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves post-Ritual-Summon pass-handoff chains back to turn-player open priority when both players pass after the handoff",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
        cards: [
          { uid: "p0-deck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-100-1", code: "100", location: "graveyard" },
          { uid: "p0-deck-200-2", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "ritualSummon", player: 0, windowId: 4, windowKind: "open", code: "900", location: "hand" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-ritual-summon-pass-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "ritualSummon", player: 0, code: "900", location: "hand" }, 4),
          absentWindowEffectGroup(0, "post-ritual-summon-pass-resolution-turn-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "post-ritual-summon-pass-resolution-turn-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-ritual-summon-pass-resolution-opponent-open-quick", 4, "open"),
        ],
        logIncludes: ["Post Ritual Summon pass resolution turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
