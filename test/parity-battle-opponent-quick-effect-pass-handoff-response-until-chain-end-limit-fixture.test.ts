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

describe("EDOPro parity opponent quick-effect pass handoff response until-chain-end limit fixture", () => {
  it("keeps until-chain-end limits after the opponent responds to a damage-step pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Opponent Handoff Until Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Handoff Until Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Handoff Until Turn Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Opponent Handoff Until Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Opponent Handoff Until Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage step quick pass handoff response until-chain-end limit fixture",
      options: { seed: 346, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500", "600", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-step-handoff-until-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture opponent damage-step handoff until open quick resolved",
          },
          {
            id: "fixture-opponent-damage-step-handoff-until-chain-limiter",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 1 },
            logMessage: "Fixture opponent damage-step handoff until chain limiter resolved",
          },
          {
            id: "fixture-opponent-damage-step-handoff-until-followup",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step handoff until followup should not resolve",
          },
          {
            id: "fixture-turn-damage-step-handoff-until-blocked",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step handoff until blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-handoff-until-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only damage-step responses after the turn player passes the opponent's quick chain before until-chain-end limits apply",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-step-handoff-until-open-quick", sourceUid: "p1-deck-300-3" }],
            chainPasses: [0],
            chainLimits: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter", count: 1 },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-followup", count: 1 },
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
                  { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-followup", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-open-quick" },
              { type: "passDamage", player: 1, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-until-open-quick", 6, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 6),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies SetChainLimitTillChainEnd restrictions after the opponent responds to a damage-step quick pass handoff",
            waitingFor: 1,
            windowId: 7,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-damage-step-handoff-until-open-quick", sourceUid: "p1-deck-300-3" },
              { player: 1, effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-followup", count: 1 },
              { type: "passChain", player: 1, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-damage-step-handoff-until-followup", 1, 7),
              chainPassGroup(1, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-until-blocked" },
              { type: "passDamage", player: 1, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-until-blocked", 7, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 7),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent damage-step SetChainLimitTillChainEnd handoff response window restorable before the allowed opponent passes",
            waitingFor: 1,
            windowId: 7,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-damage-step-handoff-until-open-quick", sourceUid: "p1-deck-300-3" },
              { player: 1, effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-until-followup", count: 1 },
              { type: "passChain", player: 1, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-damage-step-handoff-until-followup", 1, 7),
              chainPassGroup(1, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-until-blocked" },
              { type: "passDamage", player: 1, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-until-blocked", 7, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 7),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears until-chain-end limits and resumes the opponent damage-step response window after the allowed opponent passes the handoff chain",
        waitingFor: 1,
        windowId: 8,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        chainLimits: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 8)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "battle", effectId: "fixture-turn-damage-step-handoff-until-blocked" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "battle", effectId: "fixture-opponent-damage-step-handoff-until-open-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "battle", effectId: "fixture-opponent-damage-step-handoff-until-chain-limiter" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "battle", effectId: "fixture-opponent-damage-step-handoff-until-followup" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-until-blocked", 8, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-until-open-quick", 8, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-until-chain-limiter", 8, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-until-followup", 8, "battle"),
        ],
        logIncludes: [
          "Fixture opponent damage-step handoff until chain limiter resolved",
          "Fixture opponent damage-step handoff until open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
