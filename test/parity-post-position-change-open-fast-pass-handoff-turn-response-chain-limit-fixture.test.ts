import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-position-change open fast-effect handoff turn-response chain-limit fixture", () => {
  it("applies one-chain limits after the turn player responds to a post-position-change pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Position Limit Change Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Position Limit Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Position Limit Turn Chain Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Post Position Limit Turn Followup Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Position Limit Opponent Blocked Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post position change open fast pass handoff turn response chain limit fixture",
      options: { seed: 381, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "600", "700"] },
        1: { main: ["400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 0, code: "700", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-position-limit-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post position change limit turn open quick resolved",
          },
          {
            id: "post-position-limit-turn-chain-limiter",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Post position change limit turn chain limiter resolved",
          },
          {
            id: "post-position-limit-turn-followup",
            player: 0,
            code: "700",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Post position change limit turn followup should not resolve",
          },
          {
            id: "post-position-limit-opponent-blocked",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Post position change limit opponent blocked should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePosition", 0, { code: "100", location: "monsterZone", position: "faceUpDefense" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns manual position changes to turn-player open fast-effect priority before one-chain limits can be created",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            chainLimits: [],
            positionsChanged: ["p0-deck-100-0"],
            locations: { monsterZone: ["100"], graveyard: ["300", "600", "700", "400"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-position-limit-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-position-limit-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-position-limit-turn-chain-limiter" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-position-limit-turn-followup" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-position-limit-opponent-blocked" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
              },
              absentWindowEffectGroup(0, "post-position-limit-turn-chain-limiter", 1, "open"),
              absentWindowEffectGroup(0, "post-position-limit-turn-followup", 1, "open"),
              absentWindowEffectGroup(1, "post-position-limit-opponent-blocked", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-position-limit-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-position-limit-turn-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions when the turn player responds from a post-position-change pass-handoff window",
            phase: "main1",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "post-position-limit-turn-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "post-position-limit-turn-chain-limiter", sourceUid: "p0-deck-600-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            positionsChanged: ["p0-deck-100-0"],
            locations: { monsterZone: ["100"], graveyard: ["300", "600", "700", "400"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-position-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-position-limit-turn-followup", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-position-limit-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-position-limit-turn-chain-limiter" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "post-position-limit-opponent-blocked" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-position-limit-turn-open-quick", 4),
              absentChainEffectGroup(0, "post-position-limit-turn-chain-limiter", 4),
              absentChainEffectGroup(1, "post-position-limit-opponent-blocked", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and returns post-position-change handoff chains to turn-player open priority after the allowed player passes",
        phase: "main1",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        chainLimits: [],
        positionsChanged: ["p0-deck-100-0"],
        locations: { monsterZone: ["100"], graveyard: ["300", "600", "700", "400"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 5, windowKind: "open" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-position-limit-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-position-limit-turn-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-position-limit-turn-followup" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "post-position-limit-opponent-blocked" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Actions",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 5, windowKind: "open" }],
          },
          absentWindowEffectGroup(0, "post-position-limit-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "post-position-limit-turn-chain-limiter", 5, "open"),
          absentWindowEffectGroup(0, "post-position-limit-turn-followup", 5, "open"),
          absentWindowEffectGroup(1, "post-position-limit-opponent-blocked", 5, "open"),
        ],
        logIncludes: [
          "Post position change limit turn chain limiter resolved",
          "Post position change limit turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
