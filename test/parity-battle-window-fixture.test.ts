import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { directAttackGroup, passBattleGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle window fixtures", () => {
  it("opens attack response windows and advances into the damage step after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack response to damage step fixture",
      options: { seed: 60, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          after: {
            source: "edopro",
            note: "EDOPro exposes battle-phase direct attack declarations only after entering Battle Phase",
            phase: "battle",
            waitingFor: 0,
            windowKind: "open",
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 1 }],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0")],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player the first attack-response window after attack declaration",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleStep: "attack",
            windowKind: "battle",
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attackPasses: [],
            attacksDeclared: ["p0-deck-100-0"],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          after: {
            source: "edopro",
            note: "EDOPro passes the attack-response window back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "attack",
            windowKind: "battle",
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            attackPasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passAttack", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passAttack")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to the start damage step after both players pass attack responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attackPasses: [],
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains at start damage step waiting for the non-turn player's damage response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damage",
        windowKind: "battle",
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("advances from start damage step to before damage calculation after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "start damage to before calculation fixture",
      options: { seed: 61, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens start damage step before the first damage-step response pass",
            waitingFor: 1,
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes start damage step priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to before damage calculation after both players pass start damage step responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains before damage calculation waiting for the non-turn player's damage response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damage",
        windowKind: "battle",
        battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("advances from before damage calculation to during damage calculation after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "before calculation to during calculation fixture",
      options: { seed: 62, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens before damage calculation before that timing's first response pass",
            waitingFor: 1,
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes before damage calculation priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to during damage calculation after both players pass before damage calculation responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damageCalculation",
            windowKind: "battle",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains during damage calculation waiting for the non-turn player's response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damageCalculation",
        windowKind: "battle",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("advances from during damage calculation to after damage calculation after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "during calculation to after calculation fixture",
      options: { seed: 63, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens during damage calculation before that timing's first response pass",
            waitingFor: 1,
            battleStep: "damageCalculation",
            windowKind: "battle",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes during damage calculation priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damageCalculation",
            windowKind: "battle",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to after damage calculation after both players pass during damage calculation responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains after damage calculation waiting for the non-turn player's response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damage",
        windowKind: "battle",
        battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
