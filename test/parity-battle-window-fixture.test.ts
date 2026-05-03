import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, directAttackGroup, passBattleGroup, targetedAttackGroup } from "./parity-legal-action-group-helpers.js";

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
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attackPasses: [],
            attacksDeclared: ["p0-deck-100-0"],
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
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            attackPasses: [1],
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
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
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
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
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
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
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
        battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
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
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
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
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
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
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
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
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
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
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
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
        battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("advances from after damage calculation to end damage step after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "after calculation to end damage step fixture",
      options: { seed: 64, startingHandSize: 1 },
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
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens after damage calculation before that timing's first response pass",
            waitingFor: 1,
            battleStep: "damage",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes after damage calculation priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to end damage step after both players pass after damage calculation responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
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
              { eventName: "damageStepEnded", eventCode: 1141 },
            ],
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains at end damage step waiting for the non-turn player's response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damage",
        battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("clears the battle window and applies direct battle damage after end damage step passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end damage step cleanup fixture",
      options: { seed: 65, startingHandSize: 1 },
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
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens end damage step before the final pair of battle response passes",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes end damage step priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro clears the pending battle after both players pass end damage step responses",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            damagePasses: [],
            lifePoints: { 1: 6200 },
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
              { eventName: "beforeBattleDamage" },
              { eventName: "battleDamageDealt" },
            ],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state has no pending battle window after direct battle damage resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        lifePoints: { 1: 6200 },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
        legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("resolves a targeted attack by destroying the weaker attack-position monster", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "targeted attack destroys weaker attack-position monster fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          after: {
            source: "edopro",
            note: "EDOPro offers targeted attacks against opponent attack-position monsters during Battle Phase",
            phase: "battle",
            waitingFor: 0,
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            legalActionGroups: [targetedAttackGroup(0, "p0-deck-100-0", "p1-deck-200-0")],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records the attacked target before attack-response windows can alter the battle",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            attacksDeclared: ["p0-deck-100-0"],
            attackedTargetUids: ["p1-deck-200-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack")],
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
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes end damage step priority back before battle resolution destroys the weaker monster",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200"] },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro applies attack-position battle damage and destroys the lower-ATK battle target after end damage step passes",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            damagePasses: [],
            lifePoints: { 1: 7200 },
            battleDamage: { 1: 800 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            cards: [
              { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
              { uid: "p1-deck-200-0", location: "graveyard", controller: 1 },
            ],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleTargeted", eventCode: 1131, eventCardUid: "p1-deck-200-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
              { eventName: "destroying", eventCode: 1010, eventCardUid: "p1-deck-200-0" },
              { eventName: "leftField", eventCode: 1015, eventCardUid: "p1-deck-200-0" },
              { eventName: "moved", eventCode: 1030, eventCardUid: "p1-deck-200-0" },
              { eventName: "destroyed", eventCode: 1029, eventCardUid: "p1-deck-200-0" },
              { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: "p1-deck-200-0" },
              { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: "p1-deck-200-0" },
              { eventName: "beforeBattleDamage" },
              { eventName: "battleDamageDealt" },
            ],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attacker on field and sends the weaker battle target to graveyard",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        attackedTargetUids: ["p1-deck-200-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        lifePoints: { 1: 7200 },
        battleDamage: { 1: 800 },
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        cards: [
          { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
          { uid: "p1-deck-200-0", location: "graveyard", controller: 1 },
        ],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
        legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("destroys a weaker defense-position battle target without battle damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Defense Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack over defense-position target fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpDefense" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          after: {
            source: "edopro",
            note: "EDOPro allows attacks on face-up defense-position monsters during Battle Phase",
            phase: "battle",
            waitingFor: 0,
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            legalActionGroups: [targetedAttackGroup(0, "p0-deck-100-0", "p1-deck-200-0")],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records the defense-position target and opens the opponent's attack-response window",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-200-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack")],
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
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps both monsters on field until the final end damage step response pass resolves the battle",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            locations: { monsterZone: ["100", "200"] },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro destroys a lower-DEF battle target without LP damage when the attacker has no piercing damage",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            battleDamage: { 0: 0, 1: 0 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            cards: [
              { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
              { uid: "p1-deck-200-0", location: "graveyard", controller: 1 },
            ],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleTargeted", eventCode: 1131, eventCardUid: "p1-deck-200-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
              { eventName: "destroying", eventCode: 1010, eventCardUid: "p1-deck-200-0" },
              { eventName: "leftField", eventCode: 1015, eventCardUid: "p1-deck-200-0" },
              { eventName: "moved", eventCode: 1030, eventCardUid: "p1-deck-200-0" },
              { eventName: "destroyed", eventCode: 1029, eventCardUid: "p1-deck-200-0" },
              { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: "p1-deck-200-0" },
              { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: "p1-deck-200-0" },
            ],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state has no battle damage after non-piercing ATK-over-DEF destruction",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        attackedTargetUids: ["p1-deck-200-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        lifePoints: { 0: 8000, 1: 8000 },
        battleDamage: { 0: 0, 1: 0 },
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        cards: [
          { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
          { uid: "p1-deck-200-0", location: "graveyard", controller: 1 },
        ],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("reflects battle damage when attacking a stronger defense-position monster", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Small Attacker", kind: "monster", attack: 1400, defense: 1200 },
      { code: "200", name: "Large Defender", kind: "monster", attack: 1000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack into stronger defense-position target fixture",
      options: { seed: 68, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpDefense" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records attacks into defense-position targets before attack-response windows",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-200-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
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
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro applies reflected battle damage without destroying either monster when ATK is below DEF",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            lifePoints: { 0: 7400, 1: 8000 },
            battleDamage: { 0: 600, 1: 0 },
            locations: { monsterZone: ["100", "200"], graveyard: [] },
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleTargeted", eventCode: 1131, eventCardUid: "p1-deck-200-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
              { eventName: "beforeBattleDamage", eventCode: 1136 },
              { eventName: "battleDamageDealt", eventCode: 1143 },
            ],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps both monsters on field after reflected defense-position battle damage",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        attackedTargetUids: ["p1-deck-200-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        lifePoints: { 0: 7400, 1: 8000 },
        battleDamage: { 0: 600, 1: 0 },
        locations: { monsterZone: ["100", "200"], graveyard: [] },
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
