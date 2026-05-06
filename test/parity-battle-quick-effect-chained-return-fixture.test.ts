import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle quick-effect chained return fixture", () => {
  it("resolves chained damage-step quick effects back to damage-step timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Damage Step Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step chained quick return fixture",
      options: { seed: 84, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-open-quick-chain",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture damage-step open quick chain resolved",
          },
          {
            id: "fixture-opponent-damage-step-chain-quick-chain",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step chain quick chain resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-open-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent a chain-response window after a damage-step quick effect starts a chain",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-open-quick-chain", sourceUid: "p0-deck-300-1" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-chain-quick-chain", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-damage-step-chain-quick-chain", 1, 6), chainPassGroup(1, 1, 6)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-chain-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves chained damage-step quick effects and resumes start damage step timing",
            waitingFor: 1,
            windowId: 7,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 7, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 7)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-damage-step-open-quick-chain" },
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-damage-step-chain-quick-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-open-quick-chain", 7, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-quick-chain", 7, "battle"),
            ],
            logIncludes: ["Fixture opponent damage-step chain quick chain resolved", "Fixture damage-step open quick chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps start damage step timing after chained damage-step quick effects resolve",
        waitingFor: 1,
        windowId: 7,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 7, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 7)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-damage-step-open-quick-chain" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-damage-step-chain-quick-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-step-open-quick-chain", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-chain-quick-chain", 7, "battle"),
        ],
        logIncludes: ["Fixture opponent damage-step chain quick chain resolved", "Fixture damage-step open quick chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
