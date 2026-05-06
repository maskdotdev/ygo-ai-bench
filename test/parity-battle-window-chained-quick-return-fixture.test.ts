import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, passBattleGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle window chained quick return fixture", () => {
  it("resolves chained attack-response quick effects back to attack timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Attack Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Turn Attack Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response chained quick return fixture",
      options: { seed: 82, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-open-quick-chain",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture opponent attack open quick chain resolved",
          },
          {
            id: "fixture-turn-attack-chain-quick-chain",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Fixture turn attack chain quick chain resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-open-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the turn player a chain-response window after the opponent attack-response quick effect",
            waitingFor: 0,
            windowId: 3,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-open-quick-chain", sourceUid: "p1-deck-300-1" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-turn-attack-chain-quick-chain", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-attack-chain-quick-chain", 1, 3), chainPassGroup(0, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-chain-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the chained attack-response quick effects and resumes attack-response timing",
            waitingFor: 1,
            windowId: 4,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowId: 4, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack", 1, 4)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "battle", effectId: "fixture-opponent-attack-open-quick-chain" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "battle", effectId: "fixture-turn-attack-chain-quick-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-open-quick-chain", 4, "battle"),
              absentWindowEffectGroup(0, "fixture-turn-attack-chain-quick-chain", 4, "battle"),
            ],
            logIncludes: ["Fixture turn attack chain quick chain resolved", "Fixture opponent attack open quick chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps attack-response timing after chained attack-response quick effects resolve",
        waitingFor: 1,
        windowId: 4,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 4, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 4)],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "battle", effectId: "fixture-opponent-attack-open-quick-chain" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "battle", effectId: "fixture-turn-attack-chain-quick-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "fixture-opponent-attack-open-quick-chain", 4, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-chain-quick-chain", 4, "battle"),
        ],
        logIncludes: ["Fixture turn attack chain quick chain resolved", "Fixture opponent attack open quick chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
