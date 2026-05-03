import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle direct-attack lock fixtures", () => {
  it("allows direct-attack effects through occupied monster zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Direct Attack Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Direct Attack Bypass Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack legal action fixture",
      options: { seed: 88, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 74,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes both direct and targeted attacks for monsters affected by DIRECT_ATTACK while opposing monsters exist",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-100-0", directAttack: true }])],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", directAttack: true }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro accepts direct attack declarations from DIRECT_ATTACK monsters without choosing an attack target",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the direct attack pending without a battle target",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        currentAttack: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("lets cannot-direct-attack override direct-attack permissions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Conflicting Direct Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Conflicting Direct Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack blocked by cannot direct fixture",
      options: { seed: 87, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 74,
            range: ["monsterZone"],
          },
          {
            id: "fixture-cannot-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 73,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps targeted attacks legal but suppresses direct declarations when CANNOT_DIRECT_ATTACK conflicts with DIRECT_ATTACK",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }])],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves targeted attacks while the direct attack grant is blocked",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }])],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes protected monsters from battle target actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Choosing Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Protected Battle Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Battle Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot be battle target legal action fixture",
      options: { seed: 97, startingHandSize: 2 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-be-battle-target",
            player: 1,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 70,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro removes monsters affected by CANNOT_BE_BATTLE_TARGET from attack target choices while leaving other targets attackable",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 1 }],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0" }])],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes only unprotected battle targets to the UI",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 1 }],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0" }])],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes targets blocked by battle target selection effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Selection Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Selection Lock Source", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Selection Blocked Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Selection Open Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot select battle target legal action fixture",
      options: { seed: 89, startingHandSize: 3 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200", "300", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "400", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-select-battle-target",
            player: 1,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 332,
            targetRange: [0, 0x04],
            valueCardCode: "300",
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro applies CANNOT_SELECT_BATTLE_TARGET to only the target cards matched by the effect value predicate",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2", windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2" }])],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state hides only the value-matched battle target from the legal action surface",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2", windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2" }])],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes all attack actions for monsters with cannot-attack effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Locked Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot attack legal action fixture",
      options: { seed: 96, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 85,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses every attack declaration for monsters affected by CANNOT_ATTACK",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
            ],
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the monster's attack unused because all attacks are illegal",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
        ],
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes attack actions for monsters with cannot-attack-announce effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Announce Locked Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Announce Lock Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot attack announce legal action fixture",
      options: { seed: 77, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-attack-announce",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 86,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses attack declarations for monsters affected by CANNOT_ATTACK_ANNOUNCE",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
            ],
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the monster's attack unused because attack announcement is illegal",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
        ],
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes direct attack actions for monsters with cannot-direct-attack effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Direct Locked Attacker", kind: "monster", attack: 1800, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot direct attack legal action fixture",
      options: { seed: 95, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 73,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses direct-attack declarations for monsters affected by CANNOT_DIRECT_ATTACK",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attack unused because direct attacks are illegal",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
