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
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
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
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
