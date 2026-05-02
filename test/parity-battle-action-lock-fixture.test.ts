import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity battle action lock fixtures", () => {
  it("requires first-attack monsters to attack before other monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Delayed Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Required First Attacker", kind: "monster", attack: 1600, defense: 1200 },
      { code: "200", name: "First Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "first attack legal action fixture",
      options: { seed: 99, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "101"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "101", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-first-attack",
            player: 0,
            code: "101",
            location: "monsterZone",
            event: "continuous",
            effectCode: 192,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes only FIRST_ATTACK monsters until one of them has attacked",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves first-attack ordering in the legal action surface",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("forces attacks toward only-be-attacked monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Forced Target Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Must Be Attacked Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Bypassed Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "only be attacked legal action fixture",
      options: { seed: 98, startingHandSize: 2 },
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
            id: "fixture-only-be-attacked",
            player: 1,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 196,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro forces attack target selection toward monsters affected by ONLY_BE_ATTACKED",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes only the required battle target",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps the battle phase open while must-attack monsters can still attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Must Attack Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Free Attacker", kind: "monster", attack: 1600, defense: 1200 },
      { code: "200", name: "Must Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "must attack legal action fixture",
      options: { seed: 94, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "101"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "101", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-must-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 191,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps Battle Phase progression locked while a monster affected by MUST_ATTACK still has a legal attack",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
            ],
            absentLegalActions: [
              { type: "changePhase", player: 0, windowKind: "open" },
              { type: "endTurn", player: 0, windowKind: "open" },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes attacks but withholds phase/end-turn actions until the must-attack requirement is satisfied",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
        ],
        absentLegalActions: [
          { type: "changePhase", player: 0, windowKind: "open" },
          { type: "endTurn", player: 0, windowKind: "open" },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes direct attacks for monsters that must attack monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Monster-Only Attacker", kind: "monster", attack: 1800, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "must attack monster direct action fixture",
      options: { seed: 93, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-must-attack-monster",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 344,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses direct attacks for monsters affected by MUST_ATTACK_MONSTER when there are no attack targets",
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
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attack unused because monster-only attackers cannot attack directly",
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
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes direct attacks for monsters that can only attack monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Only Monster Attacker", kind: "monster", attack: 1800, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "only attack monster direct action fixture",
      options: { seed: 86, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-only-attack-monster",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 343,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses direct declarations for monsters affected by ONLY_ATTACK_MONSTER when no attack targets exist",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attack unused because only-monster attackers cannot attack directly",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps monster targets legal for monsters that can only attack monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Only Monster Targeting Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Only Monster Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "only attack monster target action fixture",
      options: { seed: 85, startingHandSize: 1 },
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
            id: "fixture-only-attack-monster",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 343,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps attack target declarations legal for monsters affected by ONLY_ATTACK_MONSTER",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes monster attacks while direct attacks remain blocked",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
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
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
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
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
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
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
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
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
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
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
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
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
