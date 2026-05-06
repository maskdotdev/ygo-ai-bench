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

describe("EDOPro parity battle quick-effect chain response fixture", () => {
  it("opens chain responses for damage-step quick effects and resumes damage-step timing after a pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Damage Step Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Turn Damage Step Chain Only Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick chain-response fixture",
      options: { seed: 78, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture damage-step open quick resolved",
          },
          {
            id: "fixture-opponent-damage-step-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step chain quick resolved",
          },
          {
            id: "fixture-turn-damage-step-chain-only-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step chain-only quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens a chain-response window inside the damage step when the opponent has a legal damage-step quick response",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-damage-step-chain-quick", 1, 6), chainPassGroup(1, 1, 6)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-chain-only-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-only-quick", 6, "chainResponse")],
          },
        }),
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
            chain: [{ player: 0, effectId: "fixture-damage-step-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-chain-only-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-damage-step-chain-only-quick", 1, 7), chainPassGroup(0, 1, 7)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-damage-step-open-quick" },
              { type: "passDamage", player: 0, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-open-quick", 7, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 7),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resumes start damage step timing after both players pass the damage-step quick chain",
            waitingFor: 1,
            windowId: 8,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 8)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 8, windowKind: "battle", effectId: "fixture-damage-step-open-quick" },
              { type: "activateEffect", player: 0, windowId: 8, windowKind: "battle", effectId: "fixture-turn-damage-step-chain-only-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-open-quick", 8, "battle"),
              absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-only-quick", 8, "battle"),
            ],
            logIncludes: ["Fixture damage-step open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps battle timing in the start damage step after a damage-step quick chain resolves",
        waitingFor: 1,
        windowId: 8,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 8)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "battle", effectId: "fixture-damage-step-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "battle", effectId: "fixture-turn-damage-step-chain-only-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-step-open-quick", 8, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-only-quick", 8, "battle"),
        ],
        logIncludes: ["Fixture damage-step open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
