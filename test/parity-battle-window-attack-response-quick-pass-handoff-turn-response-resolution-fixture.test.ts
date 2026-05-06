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

describe("EDOPro parity battle window attack-response quick pass handoff turn response resolution fixture", () => {
  it("resolves turn-player responses after the opponent chains from an attack-response pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Response Handoff Resolution Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Response Handoff Resolution Opponent Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Attack Response Handoff Resolution Opponent Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Attack Response Handoff Resolution Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick pass handoff turn response resolution fixture",
      options: { seed: 409, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "500"] },
        1: { main: ["300", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-handoff-resolution-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture opponent attack handoff resolution open quick resolved",
          },
          {
            id: "fixture-opponent-attack-handoff-resolution-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture opponent attack handoff resolution chain quick resolved",
          },
          {
            id: "fixture-turn-attack-handoff-resolution-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture turn attack handoff resolution chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes opponent attack-response quick effects after attack declaration before any pass-handoff chain begins",
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
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-resolution-open-quick", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-attack-handoff-resolution-open-quick", 1, 2), passBattleGroup(1, "passAttack", 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-resolution-chain-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-chain-quick", 2, "battle")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-handoff-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only attack-response effects after the turn player passes the opponent's attack-response quick chain",
            waitingFor: 1,
            windowId: 4,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-handoff-resolution-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-attack-handoff-resolution-chain-quick", 1, 4),
              chainPassGroup(1, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-resolution-open-quick" },
              { type: "passAttack", player: 1, windowId: 4, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-open-quick", 4, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-handoff-resolution-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player responses after the opponent chains from an attack-response pass handoff",
            waitingFor: 0,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-attack-handoff-resolution-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-attack-handoff-resolution-chain-quick", sourceUid: "p1-deck-400-1" },
            ],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-attack-handoff-resolution-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-resolution-open-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-resolution-chain-quick" },
              { type: "passAttack", player: 0, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-open-quick", 5, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-chain-quick", 5, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 5),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-handoff-resolution-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves attack-response pass-handoff chains after the turn player responds from the window reopened by the opponent's handoff response",
        waitingFor: 1,
        windowId: 6,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 6)],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-resolution-open-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-resolution-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "battle", effectId: "fixture-turn-attack-handoff-resolution-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-open-quick", 6, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-resolution-chain-quick", 6, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-resolution-chain-quick", 6, "battle"),
        ],
        logIncludes: [
          "Fixture turn attack handoff resolution chain quick resolved",
          "Fixture opponent attack handoff resolution chain quick resolved",
          "Fixture opponent attack handoff resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
