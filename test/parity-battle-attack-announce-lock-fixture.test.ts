import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle attack announce lock fixtures", () => {
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase open window restorable before applying CANNOT_ATTACK_ANNOUNCE battle action locks",
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
            note: "EDOPro suppresses attack declarations for monsters affected by CANNOT_ATTACK_ANNOUNCE",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 1, windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player end the turn from Battle Phase when attack announcement is blocked by CANNOT_ATTACK_ANNOUNCE",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 1, windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the opponent's Main Phase 1 after ending a Battle Phase where attack announcement was illegal",
            phase: "main1",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            windowId: 2,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "changePosition", player: 1, code: "200", location: "monsterZone", position: "faceUpDefense", windowId: 2, windowKind: "open", count: 1 },
              { type: "changePhase", player: 1, phase: "battle", windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Actions",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePosition", player: 1, code: "200", location: "monsterZone", position: "faceUpDefense", windowId: 2, windowKind: "open", count: 1 }],
              },
              {
                player: 1,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 1, phase: "battle", windowId: 2, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
                ],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is the opponent's Main Phase 1 after ending with attack announcement illegal",
        phase: "main1",
        waitingFor: 1,
        turn: 2,
        turnPlayer: 1,
        windowId: 2,
        windowKind: "open",
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 0, 1: 3 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "changePosition", player: 1, code: "200", location: "monsterZone", position: "faceUpDefense", windowId: 2, windowKind: "open", count: 1 },
          { type: "changePhase", player: 1, phase: "battle", windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 1,
            label: "Actions",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [{ type: "changePosition", player: 1, code: "200", location: "monsterZone", position: "faceUpDefense", windowId: 2, windowKind: "open", count: 1 }],
          },
          {
            player: 1,
            label: "Turn",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "changePhase", player: 1, phase: "battle", windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
