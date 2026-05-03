import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

const resolveBattleStepsBeforeFinalPass = [
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
];

describe("EDOPro parity battle repeat attack fixtures", () => {
  it("allows attack-all monsters to attack each opposing monster once", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack All Attacker", kind: "monster", attack: 3000, defense: 2500 },
      { code: "200", name: "First Attack-All Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Second Attack-All Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack all legal action fixture",
      options: { seed: 92, startingHandSize: 2 },
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
            id: "fixture-attack-all",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 193,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        ...resolveBattleStepsBeforeFinalPass,
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps ATTACK_ALL attackers legal against remaining opposing monsters after one battle resolves",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100", "300"], graveyard: ["200"] },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "open",
                count: 1,
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "open",
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes the next remaining attack-all target",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100", "300"], graveyard: ["200"] },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowKind: "open",
            count: 1,
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", count: 1 }],
          },
        ],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowKind: "open",
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("allows extra-attack monsters to attack directly after clearing the field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Attack Attacker", kind: "monster", attack: 3000, defense: 2500 },
      { code: "200", name: "Only Extra Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "extra attack direct legal action fixture",
      options: { seed: 91, startingHandSize: 1 },
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
            id: "fixture-extra-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 194,
            value: 1,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        ...resolveBattleStepsBeforeFinalPass,
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro lets general EXTRA_ATTACK attackers use their remaining attack directly when the opponent controls no monsters",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "open",
                count: 1,
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes the direct extra attack after the field is cleared",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowKind: "open",
            count: 1,
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("does not convert extra monster attacks into direct attacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Monster Attacker", kind: "monster", attack: 3000, defense: 2500 },
      { code: "200", name: "Only Monster Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "extra attack monster direct lock fixture",
      options: { seed: 90, startingHandSize: 1 },
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
            id: "fixture-extra-attack-monster",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 346,
            value: 1,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        ...resolveBattleStepsBeforeFinalPass,
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro monster-only extra attacks do not become direct attacks after all opposing monsters leave the field",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "open",
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state withholds direct attack actions from monster-only extra attackers",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowKind: "open",
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
