import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { attackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle direct-attack lock fixtures", () => {
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
            windowId: 1,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-100-0", directAttack: true }], 1, 1)],
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

  it("allows direct replay through occupied monster zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Direct Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Original Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "New Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Replay Target Summoner", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack replay through targets fixture",
      options: { seed: 181, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-direct-replay-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 74,
            range: ["monsterZone"],
          },
          {
            id: "fixture-summon-direct-replay-target",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
            logMessage: "Fixture direct replay target appeared",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-summon-direct-replay-target" }), { snapshotRestore: "both" }),
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
            note: "EDOPro keeps direct replay available for DIRECT_ATTACK monsters even when replay targets exist",
            waitingFor: 0,
            windowId: 16,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 16, windowKind: "battle", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 16, windowKind: "battle", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 16, windowKind: "battle", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 16, windowKind: "battle", count: 1 },
            ],
            logIncludes: ["Fixture direct replay target appeared", "Replay decision pending"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes direct and targeted replay choices for DIRECT_ATTACK monsters",
        phase: "battle",
        waitingFor: 0,
        windowId: 16,
        windowKind: "battle",
        pendingBattle: true,
        currentAttack: true,
        battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
        legalActionCounts: { 0: 4, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        logIncludes: ["Fixture direct replay target appeared", "Replay decision pending"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
