import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentPassBattleGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  effectGroup,
  passBattleGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle window attack-response quick chain fixture", () => {
  it("opens chain responses for attack-response quick effects and resumes attack timing after a pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Attack Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Turn Attack Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Opponent Attack Chain Only Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick chain-response fixture",
      options: { seed: 81, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture opponent attack open quick resolved",
          },
          {
            id: "fixture-opponent-attack-chain-only-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture opponent attack chain-only quick should not resolve",
          },
          {
            id: "fixture-turn-attack-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture turn attack chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes opponent attack-response quick effects after attack declaration",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-open-quick", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-attack-open-quick", 1, 2), passBattleGroup(1, "passAttack", 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-chain-only-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "fixture-opponent-attack-chain-only-quick", 2, "battle")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens a chain-response window inside attack-response timing when the turn player can respond",
            waitingFor: 0,
            windowId: 3,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-turn-attack-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-attack-chain-quick", 1, 3), chainPassGroup(0, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers the opponent chain-only responses after the turn player passes the attack-response quick chain",
            waitingFor: 1,
            windowId: 4,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-only-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-attack-chain-only-quick", 1, 4), chainPassGroup(1, 1, 4)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-open-quick" },
              { type: "passAttack", player: 1, windowId: 4, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-open-quick", 4, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resumes attack-response timing after both players pass the attack-response quick chain",
            waitingFor: 1,
            windowId: 5,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowId: 5, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack", 1, 5)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "battle", effectId: "fixture-opponent-attack-open-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "battle", effectId: "fixture-opponent-attack-chain-only-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-open-quick", 5, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-only-quick", 5, "battle"),
            ],
            logIncludes: ["Fixture opponent attack open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps attack-response timing after an attack-response quick chain resolves",
        waitingFor: 1,
        windowId: 5,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 5, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 5)],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "battle", effectId: "fixture-opponent-attack-open-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "battle", effectId: "fixture-opponent-attack-chain-only-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "fixture-opponent-attack-open-quick", 5, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-chain-only-quick", 5, "battle"),
        ],
        logIncludes: ["Fixture opponent attack open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
