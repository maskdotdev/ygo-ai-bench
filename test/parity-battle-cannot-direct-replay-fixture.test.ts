import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle cannot-direct replay fixtures", () => {
  it("does not offer direct replay for cannot-direct attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cannot Direct Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Removed Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Replay Target Remover", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot direct replay choice fixture",
      options: { seed: 177, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-direct-replay",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 73,
            range: ["monsterZone"],
          },
          {
            id: "fixture-remove-cannot-direct-target",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "200", from: "monsterZone", to: "graveyard" }],
            logMessage: "Fixture cannot-direct target left before replay",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro allows cannot-direct monsters to declare legal targeted attacks",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-remove-cannot-direct-target" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps the attack-response window active after the attack target leaves",
            waitingFor: 1,
            windowId: 4,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            logIncludes: ["Fixture cannot-direct target left before replay"],
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
          after: {
            source: "edopro",
            note: "EDOPro offers cancel only because CANNOT_DIRECT_ATTACK forbids direct replay",
            waitingFor: 0,
            windowId: 16,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 16,
                windowKind: "battle",
                count: 1,
                actions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 16,
                windowKind: "battle",
                actions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle" }],
              },
            ],
            logIncludes: ["Replay decision pending"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps cannot-direct replay at the cancel-only decision window",
        phase: "battle",
        waitingFor: 0,
        windowId: 16,
        windowKind: "battle",
        pendingBattle: true,
        currentAttack: true,
        battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
        legalActionCounts: { 0: 1, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowId: 16,
            windowKind: "battle",
            count: 1,
            actions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 }],
          },
        ],
        absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 16)],
        logIncludes: ["Fixture cannot-direct target left before replay", "Replay decision pending"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
