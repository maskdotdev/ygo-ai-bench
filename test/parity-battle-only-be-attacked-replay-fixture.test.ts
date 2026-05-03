import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle only-be-attacked replay fixtures", () => {
  it("filters replay choices to newly required only-be-attacked targets", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Only-Be-Attacked Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "New Required Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Bypassed Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Replay Target Summoner", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "only be attacked replay choice fixture",
      options: { seed: 180, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-only-be-attacked-replay",
            player: 1,
            code: "200",
            location: "hand",
            event: "continuous",
            effectCode: 196,
            range: ["monsterZone"],
          },
          {
            id: "fixture-summon-only-be-attacked-target",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
            logMessage: "Fixture only-be-attacked target appeared before replay",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records the initially legal replay target count before ONLY_BE_ATTACKED appears",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-summon-only-be-attacked-target" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps the attack-response window active after an ONLY_BE_ATTACKED monster appears",
            waitingFor: 1,
            windowId: 4,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", responsePlayer: 1 },
            locations: { monsterZone: ["100", "200", "300"] },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            logIncludes: ["Fixture only-be-attacked target appeared before replay"],
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
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro replay choices are forced toward the newly required ONLY_BE_ATTACKED target",
            waitingFor: 0,
            windowId: 16,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 16, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 16,
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 },
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 16, windowKind: "battle", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 16, windowKind: "battle" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1", undefined, 16)],
            logIncludes: ["Replay decision pending"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps replay choices filtered to the only-be-attacked monster",
        phase: "battle",
        waitingFor: 0,
        windowId: 16,
        windowKind: "battle",
        pendingBattle: true,
        currentAttack: true,
        battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 },
          { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 16, windowKind: "battle", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            windowId: 16,
            windowKind: "battle",
            count: 1,
            actions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 16, windowKind: "battle", count: 1 },
            ],
          },
        ],
        absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 16, windowKind: "battle" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1", undefined, 16)],
        logIncludes: ["Fixture only-be-attacked target appeared before replay", "Replay decision pending"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
