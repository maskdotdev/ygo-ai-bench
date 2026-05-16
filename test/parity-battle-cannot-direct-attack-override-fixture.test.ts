import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle cannot-direct-attack override fixtures", () => {
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase open window restorable before resolving direct-attack permission conflicts",
            phase: "main1",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 0,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 }],
              },
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps targeted attacks legal but suppresses direct declarations when CANNOT_DIRECT_ATTACK conflicts with DIRECT_ATTACK",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }], 1, 1), turnGroup(1)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true, 1)],
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
        windowId: 1,
        windowKind: "open",
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }], 1, 1), turnGroup(1)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true, 1)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
