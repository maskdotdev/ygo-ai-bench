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

describe("EDOPro parity post-Tribute-Set open fast-effect handoff turn-response chain-limit fixture", () => {
  it("applies one-chain limits after the turn player responds to a post-Tribute-Set pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Tribute Set Limit Tribute Set", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Post Tribute Set Limit Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Tribute Set Limit Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Tribute Set Limit Turn Chain Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "700", name: "Post Tribute Set Limit Turn Followup Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Tribute Set Limit Opponent Blocked Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post tribute set open fast pass handoff turn response chain limit fixture",
      options: { seed: 483, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "600", "700"] },
        1: { main: ["400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 0, code: "700", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-tribute-set-limit-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Tribute Set limit turn open quick resolved",
          },
          {
            id: "post-tribute-set-limit-turn-chain-limiter",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Post Tribute Set limit turn chain limiter resolved",
          },
          {
            id: "post-tribute-set-limit-turn-followup",
            player: 0,
            code: "700",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Post Tribute Set limit turn followup should not resolve",
          },
          {
            id: "post-tribute-set-limit-opponent-blocked",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Post Tribute Set limit opponent blocked should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSet", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Tribute Sets to turn-player open fast-effect priority before one-chain limits can be created",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            chainLimits: [],
            locations: { monsterZone: ["100"], graveyard: ["200", "300", "600", "700", "400"] },
            cards: [
              { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-tribute-set-limit-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-tribute-set-limit-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-tribute-set-limit-turn-chain-limiter" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-tribute-set-limit-turn-followup" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-tribute-set-limit-opponent-blocked" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(0, "post-tribute-set-limit-turn-chain-limiter", 1, "open"),
              absentWindowEffectGroup(0, "post-tribute-set-limit-turn-followup", 1, "open"),
              absentWindowEffectGroup(1, "post-tribute-set-limit-opponent-blocked", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-set-limit-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-set-limit-turn-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions when the turn player responds from a post-Tribute-Set pass-handoff window",
            phase: "main1",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "post-tribute-set-limit-turn-open-quick", sourceUid: "p0-deck-300-2" },
              { player: 0, effectId: "post-tribute-set-limit-turn-chain-limiter", sourceUid: "p0-deck-600-3" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            locations: { monsterZone: ["100"], graveyard: ["200", "300", "600", "700", "400"] },
            cards: [
              { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-tribute-set-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-tribute-set-limit-turn-followup", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-tribute-set-limit-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "post-tribute-set-limit-turn-chain-limiter" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "post-tribute-set-limit-opponent-blocked" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-tribute-set-limit-turn-open-quick", 4),
              absentChainEffectGroup(0, "post-tribute-set-limit-turn-chain-limiter", 4),
              absentChainEffectGroup(1, "post-tribute-set-limit-opponent-blocked", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and returns post-Tribute-Set handoff chains to turn-player open priority after the allowed player passes",
        phase: "main1",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        chainLimits: [],
        locations: { monsterZone: ["100"], graveyard: ["200", "300", "600", "700", "400"] },
        cards: [
          { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "tributeSummon", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand" },
          { type: "tributeSet", player: 0, windowId: 5, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-tribute-set-limit-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-tribute-set-limit-turn-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-tribute-set-limit-turn-followup" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "post-tribute-set-limit-opponent-blocked" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 5),
          absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 5),
          absentWindowEffectGroup(0, "post-tribute-set-limit-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "post-tribute-set-limit-turn-chain-limiter", 5, "open"),
          absentWindowEffectGroup(0, "post-tribute-set-limit-turn-followup", 5, "open"),
          absentWindowEffectGroup(1, "post-tribute-set-limit-opponent-blocked", 5, "open"),
        ],
        logIncludes: [
          "Post Tribute Set limit turn chain limiter resolved",
          "Post Tribute Set limit turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
