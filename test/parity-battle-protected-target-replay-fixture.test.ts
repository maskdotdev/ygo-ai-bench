import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, passBattleGroup, targetedAttackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle protected-target replay fixtures", () => {
  it("does not open replay when only protected raw targets differ", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Protected Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Replay Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "protected raw target does not force replay fixture",
      options: { seed: 176, startingHandSize: 2 },
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
            id: "fixture-protected-raw-replay-target",
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps Main Phase open priority restorable before protected-target battle choices are exposed",
            phase: "main1",
            waitingFor: 0,
            windowId: 0,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActions: [
              { type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(0)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 0)],

            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro excludes CANNOT_BE_BATTLE_TARGET monsters from attack choices before replay tracking starts",
            phase: "battle",
            waitingFor: 0,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [targetedAttackGroup(0, "p0-deck-100-0", "p1-deck-300-1", 1, 1), turnGroup(1)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the unprotected target attack choice restorable while protected raw targets stay absent",
            phase: "battle",
            waitingFor: 0,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [targetedAttackGroup(0, "p0-deck-100-0", "p1-deck-300-1", 1, 1), turnGroup(1)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro stores the legal attack target count without protected raw targets",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-300-1"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack", 1, 2)],
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the final end-damage-step pass restorable before resolving without replay",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200", "300"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
            absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 13, windowKind: "battle" }],

            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 13,
                windowKind: "battle",
                actions: [
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 13, windowKind: "battle" },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves battle without replay when the legal target set never changes",
            waitingFor: 0,
            windowId: 14,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 7200 },
            battleDamage: { 1: 800 },
            locations: { monsterZone: ["100", "200"], graveyard: ["300"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "battle" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 14,
                windowKind: "battle",
                actions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "battle" }],
              },
              absentAttackGroup("p0-deck-100-0", undefined, undefined, 14),
            ],
            logIncludes: ["Attacked Open Replay Target"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state proves protected raw targets do not force battle replay",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        windowId: 14,
        windowKind: "open",
        battleWindow: null,
        lifePoints: { 1: 7200 },
        battleDamage: { 1: 800 },
        attackedTargetUids: ["p1-deck-300-1"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }],
        locations: { monsterZone: ["100", "200"], graveyard: ["300"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        absentLegalActions: [
          { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "battle" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowId: 14,
            windowKind: "battle",
            actions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "battle" }],
          },
          absentAttackGroup("p0-deck-100-0", undefined, undefined, 14),
        ],
        logIncludes: ["Attacked Open Replay Target"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
