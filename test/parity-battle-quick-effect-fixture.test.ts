import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, absentEffectGroup, effectGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle quick-effect fixtures", () => {
  it("offers damage-step quick effects and resumes the battle window after resolution", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick effect fixture",
      options: { seed: 74, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            logMessage: "Fixture damage-step quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens start damage step with the non-turn player responding first after attack responses pass",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the turn player the next start damage step response and exposes damage-step fast effects",
            waitingFor: 0,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-damage-step-quick", count: 1 },
              { type: "passDamage", player: 0, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-quick"), passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resets damage-step passes after a fast effect resolves and returns priority to the opponent",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-step-quick" }] }],
            logIncludes: ["Fixture damage-step quick resolved"],
          },
        }),
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
            note: "EDOPro continues normal damage-step progression after the quick effect window resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
            logIncludes: ["Fixture damage-step quick resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state applies direct battle damage after a damage-step quick effect resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
        logIncludes: ["Fixture damage-step quick resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("offers damage-calculation quick effects only during damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Calculation Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage calculation quick effect fixture",
      options: { seed: 75, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-calculation-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            logMessage: "Fixture damage-calculation quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro does not expose damage-calculation-only fast effects during start damage step",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick" }],
            absentLegalActionGroups: [
              { player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick" }] },
            ],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro still keeps damage-calculation-only effects unavailable before damage calculation",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick" }],
            absentLegalActionGroups: [
              { player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick" }] },
            ],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes damage-calculation fast effects during the damage calculation response window",
            waitingFor: 0,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick", count: 1 },
              { type: "passDamage", player: 0, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-calculation-quick"), passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-calculation-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resumes damage calculation timing after a damage-calculation fast effect resolves",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
            absentLegalActionGroups: [
              { player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-calculation-quick" }] },
            ],
            logIncludes: ["Fixture damage-calculation quick resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro continues battle resolution after damage-calculation fast effects resolve",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
            logIncludes: ["Fixture damage-calculation quick resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state applies direct damage after a damage-calculation fast effect resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
        logIncludes: ["Fixture damage-calculation quick resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("does not offer unflagged quick effects during damage-step battle windows", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Unflagged Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "unflagged damage-step quick effect gate fixture",
      options: { seed: 76, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-unflagged-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture unflagged quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro does not expose ordinary unflagged quick effects once the Damage Step starts",
            waitingFor: 0,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable before damage calculation",
            waitingFor: 0,
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro also keeps unflagged quick effects unavailable during damage calculation",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable after damage calculation",
            waitingFor: 0,
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable at end damage step",
            waitingFor: 0,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after players pass every damage-step window",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
            ],
            absentLegalActionGroups: [absentEffectGroup(0, "fixture-unflagged-quick"), absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state never exposed the unflagged quick effect during damage-step timing",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [
          { type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
        ],
        absentLegalActionGroups: [absentEffectGroup(0, "fixture-unflagged-quick"), absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("offers opponent damage-step quick effects in the first damage-step response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage step quick effect fixture",
      options: { seed: 77, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-step-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            logMessage: "Fixture opponent damage-step quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player the first start damage step response and exposes their damage-step fast effects",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-step-quick", count: 1 },
              { type: "passDamage", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-damage-step-quick"), passDamageGroup(1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps start damage step timing with the non-turn player after their fast effect resolves",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-step-quick" }],
            absentLegalActionGroups: [
              { player: 1, label: "Effects", actions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-step-quick" }] },
            ],
            logIncludes: ["Fixture opponent damage-step quick resolved"],
          },
        }),
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
            note: "EDOPro resolves battle normally after the opponent's damage-step fast effect resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
            logIncludes: ["Fixture opponent damage-step quick resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state applies direct damage after the opponent's damage-step fast effect resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
        logIncludes: ["Fixture opponent damage-step quick resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("offers opponent damage-calculation quick effects during damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Calculation Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage calculation quick effect fixture",
      options: { seed: 78, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-calculation-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            logMessage: "Fixture opponent damage-calculation quick resolved",
          },
        ],
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
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player first response during damage calculation and exposes their damage-calculation fast effects",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-calculation-quick", count: 1 },
              { type: "passDamage", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-damage-calculation-quick"), passDamageGroup(1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resumes damage calculation timing after the opponent's damage-calculation fast effect resolves",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-calculation-quick" }],
            absentLegalActionGroups: [
              { player: 1, label: "Effects", actions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-calculation-quick" }] },
            ],
            logIncludes: ["Fixture opponent damage-calculation quick resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after the opponent's damage-calculation fast effect resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
            logIncludes: ["Fixture opponent damage-calculation quick resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state applies direct damage after the opponent's damage-calculation fast effect resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
        logIncludes: ["Fixture opponent damage-calculation quick resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("does not offer damage-step-only quick effects during damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Step Only Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick excluded from damage calculation fixture",
      options: { seed: 79, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-only-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            logMessage: "Fixture damage-step-only quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro exposes damage-step fast effects before damage calculation",
            waitingFor: 0,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-step-only-quick", count: 1 }],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-only-quick")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro does not expose regular damage-step fast effects during damage calculation",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-step-only-quick" }],
            absentLegalActionGroups: [
              { player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-step-only-quick" }] },
            ],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro exposes damage-step fast effects again after damage calculation",
            waitingFor: 0,
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-damage-step-only-quick", count: 1 }],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-only-quick")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after the damage-step-only effect timing gates are passed",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps damage-step-only quick effects out of damage calculation timing",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
