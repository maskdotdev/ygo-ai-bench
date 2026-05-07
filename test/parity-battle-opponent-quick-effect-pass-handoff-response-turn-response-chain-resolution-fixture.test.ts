import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentPassBattleGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  passDamageGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity opponent damage-step handoff response turn response chain resolution fixture", () => {
  it("resolves after the opponent chains from the damage-step turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Opponent Damage Step Chain Resolution Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Step Chain Resolution Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Damage Step Chain Resolution Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Opponent Damage Step Chain Resolution First Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Opponent Damage Step Chain Resolution Second Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage step quick pass handoff response turn response chain resolution fixture",
      options: { seed: 416, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-step-chain-resolution-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture opponent damage-step chain resolution open quick resolved",
          },
          {
            id: "fixture-turn-damage-step-chain-resolution-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step chain resolution chain quick resolved",
          },
          {
            id: "fixture-opponent-damage-step-chain-resolution-first-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step chain resolution first chain quick resolved",
          },
          {
            id: "fixture-opponent-damage-step-chain-resolution-second-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step chain resolution second chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-chain-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only damage-step responses after the turn player passes the opponent's quick chain",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-step-chain-resolution-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick", count: 1 },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 6,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-second-chain-quick", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-open-quick" },
              { type: "passDamage", player: 1, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-open-quick", 6, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 6),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-step-chain-resolution-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens opponent responses after the turn player answers a damage-step handoff chain",
            waitingFor: 1,
            windowId: 8,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-damage-step-chain-resolution-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick", sourceUid: "p1-deck-500-1" },
              { player: 0, effectId: "fixture-turn-damage-step-chain-resolution-chain-quick", sourceUid: "p0-deck-400-1" },
            ],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 8, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-second-chain-quick", 1, 8),
              chainPassGroup(1, 1, 8),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-chain-resolution-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-open-quick" },
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick" },
              { type: "passDamage", player: 1, windowId: 8, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-resolution-chain-quick", 8, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-open-quick", 8, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-first-chain-quick", 8, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 8),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-chain-resolution-second-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves opponent damage-step handoff chains after the opponent chains from the response window reopened by the turn player's answer",
        waitingFor: 1,
        windowId: 9,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 9, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 9)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-turn-damage-step-chain-resolution-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "battle", effectId: "fixture-opponent-damage-step-chain-resolution-open-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "battle", effectId: "fixture-opponent-damage-step-chain-resolution-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "battle", effectId: "fixture-opponent-damage-step-chain-resolution-second-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-resolution-chain-quick", 9, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-open-quick", 9, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-first-chain-quick", 9, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-resolution-second-chain-quick", 9, "battle"),
        ],
        logIncludes: [
          "Fixture opponent damage-step chain resolution second chain quick resolved",
          "Fixture turn damage-step chain resolution chain quick resolved",
          "Fixture opponent damage-step chain resolution first chain quick resolved",
          "Fixture opponent damage-step chain resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
