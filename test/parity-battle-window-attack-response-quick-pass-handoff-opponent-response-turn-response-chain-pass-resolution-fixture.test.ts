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

describe("EDOPro parity battle attack-response handoff opponent response turn response chain-pass resolution fixture", () => {
  it("resolves attack-response handoff chains after the opponent passes the turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Response Chain Pass Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Response Chain Pass Opponent Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Attack Response Chain Pass Opponent First Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Attack Response Chain Pass Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Attack Response Chain Pass Opponent Second Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick pass handoff opponent response turn response chain pass resolution fixture",
      options: { seed: 413, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "500"] },
        1: { main: ["300", "400", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-chain-pass-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture opponent attack chain pass open quick resolved",
          },
          {
            id: "fixture-opponent-attack-chain-pass-first-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture opponent attack chain pass first chain quick resolved",
          },
          {
            id: "fixture-turn-attack-chain-pass-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture turn attack chain pass chain quick resolved",
          },
          {
            id: "fixture-opponent-attack-chain-pass-second-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture opponent attack chain pass second chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes opponent attack-response quick effects after attack declaration before any handoff chain starts",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-open-quick", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              effectGroup(1, "fixture-opponent-attack-chain-pass-open-quick", 1, 2),
              passBattleGroup(1, "passAttack", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-second-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-first-chain-quick", 2, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-second-chain-quick", 2, "battle"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-chain-pass-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only attack-response effects after the turn player passes the opponent's quick chain",
            waitingFor: 1,
            windowId: 4,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-chain-pass-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-first-chain-quick", count: 1 },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 4,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-first-chain-quick", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-second-chain-quick", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-open-quick" },
              { type: "passAttack", player: 1, windowId: 4, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-open-quick", 4, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-chain-pass-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-chain-pass-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens opponent responses after the turn player answers an attack-response handoff chain",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-attack-chain-pass-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-attack-chain-pass-first-chain-quick", sourceUid: "p1-deck-400-1" },
              { player: 0, effectId: "fixture-turn-attack-chain-pass-chain-quick", sourceUid: "p0-deck-500-1" },
            ],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-attack-chain-pass-second-chain-quick", 1, 6),
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-attack-chain-pass-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-open-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-chain-pass-first-chain-quick" },
              { type: "passAttack", player: 1, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-chain-pass-chain-quick", 6, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-open-quick", 6, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-first-chain-quick", 6, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 6),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves attack-response handoff chains after the opponent passes the response window reopened by the turn player's answer",
        waitingFor: 1,
        windowId: 7,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 7, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 7)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-chain-pass-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-open-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-attack-chain-pass-second-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-attack-chain-pass-chain-quick", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-open-quick", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-first-chain-quick", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-chain-pass-second-chain-quick", 7, "battle"),
        ],
        logIncludes: [
          "Fixture turn attack chain pass chain quick resolved",
          "Fixture opponent attack chain pass first chain quick resolved",
          "Fixture opponent attack chain pass open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
