import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentPassBattleGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle quick-effect pass handoff turn response fixture", () => {
  it("opens opponent responses after the turn player chains from damage-step pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Handoff Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Battle Handoff Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Battle Handoff Opponent Damage Step Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Battle Handoff Turn Damage Step Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick pass handoff turn response fixture",
      options: { seed: 326, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-handoff-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture damage-step handoff open quick should not resolve yet",
          },
          {
            id: "fixture-opponent-damage-step-handoff-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step handoff chain quick should not resolve yet",
          },
          {
            id: "fixture-turn-damage-step-handoff-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step handoff chain quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-handoff-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only damage-step responses after the opponent passes the damage-step quick chain",
            waitingFor: 0,
            windowId: 7,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-handoff-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-damage-step-handoff-chain-quick", 1, 7), chainPassGroup(0, 1, 7)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-damage-step-handoff-open-quick" },
              { type: "passDamage", player: 0, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-handoff-open-quick", 7, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 7),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-step-handoff-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro reopens opponent response priority after the turn player chains from a damage-step quick pass handoff",
        waitingFor: 1,
        windowId: 8,
        windowKind: "chainResponse",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
        chain: [
          { player: 0, effectId: "fixture-damage-step-handoff-open-quick", sourceUid: "p0-deck-300-1" },
          { player: 0, effectId: "fixture-turn-damage-step-handoff-chain-quick", sourceUid: "p0-deck-500-2" },
        ],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 8, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-opponent-damage-step-handoff-chain-quick", 1, 8),
          chainPassGroup(1, 1, 8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-damage-step-handoff-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-quick" },
          { type: "passDamage", player: 1, windowId: 8, windowKind: "battle" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-step-handoff-open-quick", 8, "chainResponse"),
          absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-chain-quick", 8, "chainResponse"),
          absentPassBattleGroup(1, "passDamage", 8),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
