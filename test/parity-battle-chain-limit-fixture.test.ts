import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity battle chain-limit fixtures", () => {
  it("applies chain limits from attack-response quick effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Limit Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Battle Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Battle Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Turn Followup Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "battle attack response chain limit fixture",
      options: { seed: 80, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-turn-chain-limiter",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Fixture turn chain limiter resolved",
          },
          {
            id: "fixture-turn-followup-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture turn followup resolved",
          },
          {
            id: "fixture-opponent-blocked-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture opponent quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          after: {
            source: "edopro",
            note: "EDOPro opens an attack-response window where the opponent may answer a direct attack",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-blocked-quick", count: 1 },
              { type: "passAttack", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowKind: "battle", effectId: "fixture-opponent-blocked-quick", count: 1 }],
              },
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          after: {
            source: "edopro",
            note: "EDOPro passes attack-response priority to the turn player before the Damage Step begins",
            waitingFor: 0,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-turn-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, effectId: "fixture-turn-followup-quick", count: 1 },
              { type: "passAttack", player: 0, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-turn-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-turn-followup-quick", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 0, windowKind: "battle", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-chain-limiter" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro applies Duel.SetChainLimit-style restrictions immediately after the attack-response quick effect is placed on chain",
            waitingFor: 0,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-turn-chain-limiter" }],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 1 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-turn-followup-quick", count: 1 },
              { type: "passChain", player: 0, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowKind: "chainResponse", effectId: "fixture-turn-followup-quick", count: 1 }],
              },
              {
                player: 0,
                label: "Pass",
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "passChain", player: 0, windowKind: "chainResponse", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-blocked-quick" },
              { type: "passAttack", player: 0, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                actions: [{ type: "activateEffect", player: 1, windowKind: "chainResponse", effectId: "fixture-opponent-blocked-quick" }],
              },
              {
                player: 0,
                label: "Pass",
                actions: [{ type: "passAttack", player: 0, windowKind: "battle" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          after: {
            source: "edopro",
            note: "EDOPro clears one-chain chain limits after the restricted chain resolves and returns to the attack-response window",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainLimits: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-blocked-quick", count: 1 },
              { type: "passAttack", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowKind: "battle", effectId: "fixture-opponent-blocked-quick", count: 1 }],
              },
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
              },
            ],
            logIncludes: ["Fixture turn chain limiter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro continues direct battle resolution after attack-response chain limits expire",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            logIncludes: ["Fixture turn chain limiter resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the attack and damage outcome after a chain-limited battle response",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        chainLimits: [],
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        logIncludes: ["Fixture turn chain limiter resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps attack-response chain limits until the chain resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Limit Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Persistent Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Allowed Opponent Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Blocked Turn Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "battle attack response until-chain-end limit fixture",
      options: { seed: 81, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-until-chain-end-limiter",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 1 },
            logMessage: "Fixture until-chain-end limiter resolved",
          },
          {
            id: "fixture-blocked-turn-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture blocked turn quick resolved",
          },
          {
            id: "fixture-allowed-opponent-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture allowed opponent quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          after: {
            source: "edopro",
            note: "EDOPro lets the turn player respond after the opponent passes the attack-response window",
            waitingFor: 0,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-until-chain-end-limiter", count: 1 },
              { type: "activateEffect", player: 0, effectId: "fixture-blocked-turn-quick", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-until-chain-end-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-blocked-turn-quick", count: 1 },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-until-chain-end-limiter" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps Duel.SetChainLimitTillChainEnd restrictions active for the whole response chain",
            waitingFor: 1,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-until-chain-end-limiter" }],
            chainLimits: [{ untilChainEnd: true }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-allowed-opponent-quick", count: 1 },
              { type: "passChain", player: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowKind: "chainResponse", effectId: "fixture-allowed-opponent-quick", count: 1 }],
              },
              {
                player: 1,
                label: "Pass",
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "passChain", player: 1, windowKind: "chainResponse", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-blocked-turn-quick" },
              { type: "passAttack", player: 1, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                actions: [{ type: "activateEffect", player: 0, windowKind: "chainResponse", effectId: "fixture-blocked-turn-quick" }],
              },
              {
                player: 1,
                label: "Pass",
                actions: [{ type: "passAttack", player: 1, windowKind: "battle" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-allowed-opponent-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves the chain when the until-chain-end limit leaves no legal turn-player response",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainLimits: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "passAttack", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-blocked-turn-quick" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-blocked-turn-quick" }],
              },
            ],
            logIncludes: ["Fixture allowed opponent quick resolved", "Fixture until-chain-end limiter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro continues direct battle resolution after until-chain-end limits clear",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            logIncludes: ["Fixture allowed opponent quick resolved", "Fixture until-chain-end limiter resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves direct battle damage after an until-chain-end battle response limit",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        chainLimits: [],
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        logIncludes: ["Fixture allowed opponent quick resolved", "Fixture until-chain-end limiter resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
