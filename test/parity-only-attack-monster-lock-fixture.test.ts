import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity only-attack-monster lock fixtures", () => {
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
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase transition to Battle Phase restorable before evaluating ONLY_ATTACK_MONSTER attack legality",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 }],

            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro suppresses direct declarations for monsters affected by ONLY_ATTACK_MONSTER when no attack targets exist",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true, 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player end the turn from Battle Phase when ONLY_ATTACK_MONSTER leaves no legal attack targets",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the opponent's Main Phase 1 after ending a Battle Phase where only-monster attacks were illegal",
            phase: "main1",
            windowId: 2,
            windowKind: "open",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
                ],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is the opponent's Main Phase 1 after ending with only-monster attacks illegal",
        phase: "main1",
        waitingFor: 1,
        turn: 2,
        turnPlayer: 1,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [
          { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 1,
            label: "Turn",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
