import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle replay fixtures", () => {
  it("opens a replay decision and allows canceling when the attack target leaves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Target Remover", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "target leaves before battle replay fixture",
      options: { seed: 69, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-remove-target-before-replay",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "200", from: "monsterZone", to: "graveyard" }],
            logMessage: "Fixture target left before replay",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records the original target before a later attack replay can be required",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-200-1"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }],
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-remove-target-before-replay" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps the attack-response window active after a quick effect removes the target",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", responsePlayer: 1 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, count: 1 }],
              },
            ],
            logIncludes: ["Fixture target left before replay"],
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
            note: "EDOPro opens replay decision instead of resolving damage when the attack target has left the field",
            waitingFor: 0,
            pendingBattle: true,
            currentAttack: true,
            battleStep: "attack",
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
            ],
            absentLegalActions: [{ type: "passDamage", player: 0 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
                ],
              },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Pass",
                windowKind: "battle",
                actions: [{ type: "passDamage", player: 0 }],
              },
            ],
            logIncludes: ["Replay decision pending"],
          },
        }),
        makeScriptedStep(makeResponseSelector("cancelAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro exposes cancel attack as a legal replay response for the turn player",
            pendingBattle: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro clears the pending battle when the replay decision cancels the attack",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
              },
            ],
            logIncludes: ["Canceled replay attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves attack history and the removed target after replay cancellation",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        attacksDeclared: ["p0-deck-100-0"],
        attackedTargetUids: ["p1-deck-200-1"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }],
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        cards: [
          { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
          { uid: "p1-deck-200-1", location: "graveyard", controller: 1 },
        ],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          },
        ],
        logIncludes: ["Fixture target left before replay", "Replay decision pending", "Canceled replay attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("opens replay choices when the number of attack targets changes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Target Summoner", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "target count changes before battle replay fixture",
      options: { seed: 70, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "300"] },
        1: { main: ["200", "200", "200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-add-target-before-replay",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
            logMessage: "Fixture target count changed before replay",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro records the original target before the attack target count changes",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-200-1"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-add-target-before-replay" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps the attack-response window active after a quick effect adds a new possible attack target",
            waitingFor: 1,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", responsePlayer: 1 },
            locations: { monsterZone: ["100", "200"] },
            locationCounts: { monsterZone: { "100": 1, "200": 2 } },
            logIncludes: ["Fixture target count changed before replay"],
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
            note: "EDOPro opens replay decision when the number of legal attack targets changes before damage resolves",
            waitingFor: 0,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1", count: 1 },
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", count: 1 },
                ],
              },
            ],
            logIncludes: ["Replay decision pending"],
          },
        }),
        makeScriptedStep(makeResponseSelector("replayAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro exposes each current legal target as a replay attack choice",
            pendingBattle: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro reopens the opponent's attack-response window after replaying the attack onto a selected target",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", responsePlayer: 1 },
            attackedTargetUids: ["p1-deck-200-1", "p1-deck-200-2"],
            battlePairs: [
              { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" },
              { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" },
            ],
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, count: 1 }],
              },
            ],
            logIncludes: ["Replayed attack on Replay Target"],
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
            note: "EDOPro resolves the replayed attack against the selected new target after normal battle windows pass",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 7200 },
            battleDamage: { 1: 800 },
            locations: { monsterZone: ["100", "200"], graveyard: ["200"] },
            locationCounts: { monsterZone: { "100": 1, "200": 1 }, graveyard: { "200": 1 } },
            cards: [
              { uid: "p1-deck-200-1", location: "monsterZone", controller: 1 },
              { uid: "p1-deck-200-2", location: "graveyard", controller: 1 },
            ],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state resolves the replayed attack against the selected current target",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attackedTargetUids: ["p1-deck-200-1", "p1-deck-200-2"],
        battlePairs: [
          { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" },
          { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" },
        ],
        lifePoints: { 1: 7200 },
        battleDamage: { 1: 800 },
        locationCounts: { monsterZone: { "100": 1, "200": 1 }, graveyard: { "200": 1 } },
        cards: [
          { uid: "p1-deck-200-1", location: "monsterZone", controller: 1 },
          { uid: "p1-deck-200-2", location: "graveyard", controller: 1 },
        ],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
        logIncludes: ["Fixture target count changed before replay", "Replay decision pending", "Replayed attack on Replay Target"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("replays directly when the original target leaves and no targets remain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Replay Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Replay Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Target Remover", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "target leaves replay direct attack fixture",
      options: { seed: 71, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-remove-target-before-direct-replay",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            moveCardsOnResolve: [{ player: 1, code: "200", from: "monsterZone", to: "graveyard" }],
            logMessage: "Fixture target left before direct replay",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-remove-target-before-direct-replay" })),
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
            note: "EDOPro offers direct replay when the original attack target leaves and no opponent monsters remain",
            waitingFor: 0,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActions: [
              { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
              { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
            ],
            absentLegalActions: [{ type: "passDamage", player: 0 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [
                  { type: "cancelAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
                  { type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 },
                ],
              },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Pass",
                windowKind: "battle",
                actions: [{ type: "passDamage", player: 0 }],
              },
            ],
            logIncludes: ["Replay decision pending"],
          },
        }),
        makeScriptedStep(makeResponseSelector("replayAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro exposes no-target replayAttack as the direct replay choice",
            pendingBattle: true,
            battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "replayAttack", player: 0, attackerUid: "p0-deck-100-0", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro reopens attack responses after choosing direct replay",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [
              {
                player: 1,
                label: "Pass",
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, count: 1 }],
              },
            ],
            logIncludes: ["Replayed direct attack"],
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
            note: "EDOPro resolves the direct replay as direct battle damage after both players pass battle windows",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state resolves direct replay damage while preserving the original target history",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        attackedTargetUids: ["p1-deck-200-1"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-1" }],
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Attacks",
            actions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          },
        ],
        logIncludes: ["Fixture target left before direct replay", "Replay decision pending", "Replayed direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
