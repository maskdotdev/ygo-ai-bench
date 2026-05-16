import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

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

describe("EDOPro parity battle extra monster attack lock fixtures", () => {
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the final opposing monster on field before the final end-damage-step pass recalculates monster-only extra attacks",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro monster-only extra attacks do not become direct attacks after all opposing monsters leave the field",
            phase: "battle",
            windowId: 14,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player end the turn after monster-only extra attacks have no legal attack targets",
            phase: "battle",
            windowId: 14,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the opponent's Main Phase 1 after ending with monster-only extra attacks unavailable",
            phase: "main1",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            windowId: 15,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            battlePairs: [],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "changePhase", player: 1, phase: "battle", windowId: 15, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 15, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Turn",
                windowId: 15,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 1, phase: "battle", windowId: 15, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 15, windowKind: "open", count: 1 },
                ],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is the opponent's Main Phase 1 after ending with monster-only extra attacks unavailable",
        phase: "main1",
        waitingFor: 1,
        turn: 2,
        turnPlayer: 1,
        windowId: 15,
        windowKind: "open",
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        battlePairs: [],
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [
          { type: "changePhase", player: 1, phase: "battle", windowId: 15, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 15, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 1,
            label: "Turn",
            windowId: 15,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "changePhase", player: 1, phase: "battle", windowId: 15, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 15, windowKind: "open", count: 1 },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
