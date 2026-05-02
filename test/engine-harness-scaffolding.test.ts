import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows, parseBanlistConf, scriptFilenameForCard, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("normalizes card database rows and banlist entries", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 2500, def: 2100, level: 4 | (8 << 16) | (3 << 24), setcode: 0, race: 0x2, attribute: 0x20 },
        { id: 200, type: 2 },
        { id: 300, type: 4 },
      ],
      [
        { id: 100, name: "Fixture Monster" },
        { id: 200, name: "Fixture Spell" },
      ],
    );

    expect(cards.map((card) => card.kind)).toEqual(["monster", "spell", "trap"]);
    expect(cards[0]?.name).toBe("Fixture Monster");
    expect(cards[0]?.race).toBe(0x2);
    expect(cards[0]?.attribute).toBe(0x20);
    expect(cards[0]).toMatchObject({ level: 4, leftScale: 3, rightScale: 8 });
    expect(scriptFilenameForCard(100)).toBe("c100.lua");
    const upstream = { root: ".upstream/ignis", coreUrl: "core", scriptsUrl: "scripts", databaseUrl: "db", lflistUrl: "lists" };
    expect(upstreamScriptPath(upstream, 100)).toBe(".upstream/ignis/script/c100.lua");
    expect(upstreamDatabasePath(upstream, "cards.cdb")).toBe(".upstream/ignis/cdb/cards.cdb");
    expect(upstreamBanlistPath(upstream, "lflist.conf")).toBe(".upstream/ignis/lflist.conf");
    expect(parseBanlistConf("100 1\n# comment\n200 0\n!header\n300 4")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);
  });

  it("runs a scripted duel fixture against the TypeScript engine", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "normal summon fixture",
        options: { seed: 4, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "400"] },
        },
        before: {
          source: "edopro",
          windowId: 0,
          waitingFor: 0,
          phase: "main1",
          legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", count: 1 }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              windowId: 1,
              waitingFor: 0,
              phase: "main1",
              absentLegalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand" }],
              legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              logIncludes: ["Normal Summoned"],
            },
          }),
        ],
        expected: {
          windowId: 1,
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("runs scripted battle-window fixtures against the TypeScript engine", () => {
    const battleCards: DuelCardData[] = [
      { code: "100", name: "Fixture Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Fixture Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Fixture Defender", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixtures: ScriptedDuelFixture[] = [
      {
        name: "direct attack pass fixture",
        options: { seed: 41, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
            after: {
              source: "edopro",
              windowId: 2,
              waitingFor: 1,
              phase: "battle",
              battleStep: "attack",
              battleWindow: {
                id: 1,
                kind: "attackNegationResponse",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
              absentLegalActions: [{ type: "passDamage", player: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passAttack", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              windowId: 2,
              waitingFor: 1,
              battleStep: "attack",
              battleWindow: {
                id: 1,
                kind: "attackNegationResponse",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passAttack", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleStep: "damage",
              battleWindow: {
                kind: "startDamageStep",
                step: "damage",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleStep: "damage",
              battleWindow: {
                kind: "beforeDamageCalculation",
                step: "damage",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleStep: "damageCalculation",
              battleWindow: {
                kind: "duringDamageCalculation",
                step: "damageCalculation",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleStep: "damage",
              battleWindow: {
                kind: "afterDamageCalculation",
                step: "damage",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleStep: "damage",
              battleWindow: {
                kind: "endDamageStep",
                step: "damage",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
        ],
        expected: {
          phase: "battle",
          waitingFor: 0,
          lifePoints: { 1: 6200 },
          pendingBattle: false,
          currentAttack: false,
          battleWindow: null,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          legalActions: [{ type: "changePhase", player: 0, phase: "main2", count: 1 }],
          absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          locations: { monsterZone: ["100"] },
          logIncludes: ["Direct attack"],
        },
      },
      {
        name: "attack window quick fixture",
        options: { seed: 42, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
          effects: [
            {
              id: "fixture-attack-window-quick",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              logMessage: "Fixture attack-window quick resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
          makeScriptedStep(makeResponseSelector("passAttack", 1)),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-attack-window-quick" })),
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
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
        ],
        expected: {
          phase: "battle",
          waitingFor: 0,
          lifePoints: { 1: 6200 },
          pendingBattle: false,
          currentAttack: false,
          battleWindow: null,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          legalActions: [{ type: "changePhase", player: 0, phase: "main2", count: 1 }],
          absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          locations: { monsterZone: ["100"] },
          logIncludes: ["Fixture attack-window quick resolved", "Direct attack"],
        },
      },
      {
        name: "damage window quick fixture",
        options: { seed: 43, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
          effects: [
            {
              id: "fixture-damage-step-quick",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              property: 0x4000,
              logMessage: "Fixture damage-step quick resolved",
            },
            {
              id: "fixture-damage-calculation-quick",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              property: 0x8000,
              logMessage: "Fixture damage-calculation quick resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
          makeScriptedStep(makeResponseSelector("passAttack", 1)),
          makeScriptedStep(makeResponseSelector("passAttack", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-quick" })),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-calculation-quick" })),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
          makeScriptedStep(makeResponseSelector("passDamage", 1)),
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
        ],
        expected: {
          phase: "battle",
          waitingFor: 0,
          lifePoints: { 1: 6200 },
          pendingBattle: false,
          currentAttack: false,
          battleWindow: null,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          legalActions: [{ type: "changePhase", player: 0, phase: "main2", count: 1 }],
          absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          locations: { monsterZone: ["100"] },
          logIncludes: ["Fixture damage-step quick resolved", "Fixture damage-calculation quick resolved", "Direct attack"],
        },
      },
      {
        name: "replay decision after target leaves fixture",
        options: { seed: 44, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [
            { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
            { player: 1, code: "400", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          ],
          effects: [
            {
              id: "fixture-remove-target-before-damage",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              moveCardsOnResolve: [{ player: 1, code: "400", from: "monsterZone", to: "graveyard" }],
              logMessage: "Fixture target left before damage",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1" })),
          makeScriptedStep(makeResponseSelector("passAttack", 1)),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-remove-target-before-damage" })),
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
            after: {
              source: "edopro",
              battleStep: "attack",
              battleWindow: {
                kind: "replayDecision",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 0,
                attackNegated: false,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [
                { type: "cancelAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", count: 1 },
                { type: "replayAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", count: 1 },
              ],
              absentLegalActions: [{ type: "passDamage", player: 0 }],
              logIncludes: ["Replay decision pending"],
            },
          }),
          makeScriptedStep(makeResponseSelector("cancelAttack", 0, { attackerUid: "p0-deck-100-0" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleWindow: {
                kind: "replayDecision",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 0,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "cancelAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", count: 1 }],
            },
          }),
        ],
        expected: {
          phase: "battle",
          waitingFor: 0,
          lifePoints: { 1: 8000 },
          pendingBattle: false,
          currentAttack: false,
          battleWindow: null,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          legalActions: [{ type: "changePhase", player: 0, phase: "main2", count: 1 }],
          absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          attacksDeclared: ["p0-deck-100-0"],
          attackCanceledUids: [],
          attackedTargetUids: ["p1-deck-400-1"],
          battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1" }],
          locations: { monsterZone: ["100"], graveyard: ["400"] },
          locationCounts: { monsterZone: { "100": 1 }, graveyard: { "400": 1 } },
          cards: [
            { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
            { uid: "p1-deck-400-1", location: "graveyard", controller: 1 },
          ],
          logIncludes: ["Fixture target left before damage", "Replay decision pending", "Canceled replay attack"],
        },
      },
      {
        name: "replay decision after target count changes fixture",
        options: { seed: 45, startingHandSize: 3 },
        decks: {
          0: { main: ["100", "300", "300"] },
          1: { main: ["400", "400", "400"] },
        },
        setup: {
          moveCards: [
            { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
            { player: 1, code: "400", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          ],
          effects: [
            {
              id: "fixture-add-target-before-damage",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              moveCardsOnResolve: [{ player: 1, code: "400", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
              logMessage: "Fixture target count changed before damage",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2" })),
          makeScriptedStep(makeResponseSelector("passAttack", 1)),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-add-target-before-damage" })),
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
            after: {
              source: "edopro",
              battleWindow: {
                kind: "replayDecision",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 0,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [
                { type: "cancelAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", count: 1 },
                { type: "replayAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2", count: 1 },
                { type: "replayAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1", count: 1 },
              ],
              logIncludes: ["Replay decision pending"],
            },
          }),
          makeScriptedStep(makeResponseSelector("replayAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              battleWindow: { kind: "replayDecision", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "replayAttack", player: 0, windowId: 16, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1", count: 1 }],
            },
            after: {
              source: "edopro",
              battleWindow: {
                kind: "attackNegationResponse",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                targetUid: "p1-deck-400-1",
                responsePlayer: 1,
              },
              pendingBattle: true,
              currentAttack: true,
              legalActions: [{ type: "passAttack", player: 1, count: 1 }],
              logIncludes: ["Replayed attack on Fixture Defender"],
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
          makeScriptedStep(makeResponseSelector("passDamage", 0)),
        ],
        expected: {
          phase: "battle",
          waitingFor: 0,
          lifePoints: { 1: 7700 },
          pendingBattle: false,
          currentAttack: false,
          battleWindow: null,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          legalActions: [{ type: "changePhase", player: 0, phase: "main2", count: 1 }],
          absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0" }],
          attacksDeclared: ["p0-deck-100-0"],
          attackCanceledUids: [],
          attackedTargetUids: ["p1-deck-400-2", "p1-deck-400-1"],
          battlePairs: [
            { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-2" },
            { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-400-1" },
          ],
          locations: { monsterZone: ["100", "400"], graveyard: ["400"] },
          locationCounts: { monsterZone: { "100": 1, "400": 1 }, graveyard: { "400": 1 } },
          cards: [
            { uid: "p0-deck-100-0", location: "monsterZone", controller: 0 },
            { uid: "p1-deck-400-2", location: "monsterZone", controller: 1 },
            { uid: "p1-deck-400-1", location: "graveyard", controller: 1 },
          ],
          logIncludes: ["Fixture target count changed before damage", "Replay decision pending", "Replayed attack on Fixture Defender"],
        },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(battleCards) })).toEqual({ ok: true, failures: [] });
    }
  });

  it("reports fixture effect movement failures with rollback", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Ignition", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Fixture Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Fixture Defender", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const result = runScriptedDuelFixture(
      {
        name: "missing fixture move rollback",
        options: { seed: 46, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-missing-move",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              moveCardsOnResolve: [{ player: 1, code: "999", from: "hand", to: "graveyard" }],
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-missing-move" })),
        ],
        expected: {
          windowId: 0,
          phase: "main1",
          pendingBattle: false,
          currentAttack: false,
          locations: { hand: ["100", "300", "400"] },
          locationCounts: { graveyard: { "999": 0 }, hand: { "100": 1, "300": 1, "400": 2 } },
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toEqual({
      fixture: "missing fixture move rollback",
      message: "Fixture effect could not move 999 for player 1",
    });
    expect(result.failures).toHaveLength(1);
  });

  it("runs a scripted trigger-controller fast-effect fixture", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Fixture Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Fixture Quick", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const result = runScriptedDuelFixture(
      {
        name: "trigger controller fast effect fixture",
        options: { seed: 49, startingHandSize: 3 },
        decks: {
          0: { main: ["100", "300", "500"] },
          1: { main: ["100", "100", "100"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-normal-summon-trigger",
              player: 0,
              code: "300",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              range: ["hand"],
              logMessage: "Fixture trigger resolved",
            },
            {
              id: "fixture-self-fast-quick",
              player: 0,
              code: "500",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture self fast quick resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            after: {
              source: "edopro",
              windowId: 1,
              waitingFor: 0,
              pendingTriggers: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", triggerBucket: "turnOptional", eventCardUid: "p0-deck-100-0" }],
              legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-normal-summon-trigger" }), {
            after: {
              source: "edopro",
              windowId: 2,
              waitingFor: 0,
              chain: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
              pendingTriggers: [],
              legalActions: [
                { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "fixture-self-fast-quick", count: 1 },
                { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
              ],
              absentLegalActions: [{ type: "activateEffect", player: 1 }],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-self-fast-quick" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              windowId: 2,
              waitingFor: 0,
              legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "fixture-self-fast-quick", count: 1 }],
            },
          }),
        ],
        expected: {
          windowId: 3,
          phase: "main1",
          waitingFor: 0,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          locations: { monsterZone: ["100"], hand: ["300", "500"] },
          logIncludes: ["Fixture self fast quick resolved", "Fixture trigger resolved"],
          legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("runs a scripted opponent fast-effect response fixture", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Fixture Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Fixture Quick", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const result = runScriptedDuelFixture(
      {
        name: "opponent fast effect response fixture",
        options: { seed: 50, startingHandSize: 3 },
        decks: {
          0: { main: ["100", "300", "500"] },
          1: { main: ["500", "100", "100"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-normal-summon-trigger",
              player: 0,
              code: "300",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              range: ["hand"],
              logMessage: "Fixture trigger resolved",
            },
            {
              id: "fixture-opponent-fast-quick",
              player: 1,
              code: "500",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture opponent fast quick resolved",
            },
            {
              id: "fixture-turn-fast-quick",
              player: 0,
              code: "500",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture turn fast quick resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
          makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-normal-summon-trigger" }), {
            after: {
              source: "edopro",
              windowId: 2,
              waitingFor: 1,
              chain: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
              pendingTriggers: [],
              legalActions: [
                { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-opponent-fast-quick", count: 1 },
                { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
              ],
              absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-turn-fast-quick" }],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-fast-quick" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              windowId: 2,
              waitingFor: 1,
              legalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-opponent-fast-quick", count: 1 }],
            },
            after: {
              source: "edopro",
              windowId: 3,
              waitingFor: 0,
              chain: [
                { player: 0, effectId: "fixture-normal-summon-trigger" },
                { player: 1, effectId: "fixture-opponent-fast-quick" },
              ],
              legalActions: [
                { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-turn-fast-quick", count: 1 },
                { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
              ],
            },
          }),
          makeScriptedStep(makeResponseSelector("passChain", 0)),
          makeScriptedStep(makeResponseSelector("passChain", 1)),
        ],
        expected: {
          windowId: 5,
          phase: "main1",
          waitingFor: 0,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          locations: { monsterZone: ["100"], hand: ["300", "500"] },
          logIncludes: ["Fixture opponent fast quick resolved", "Fixture trigger resolved"],
          legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("selects extra deck scripted fixture responses by material uids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Fixture Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Fixture Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Fixture Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Fixture Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Fixture Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const fixtureBase = {
      options: { seed: 3, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["100", "300"] },
      },
    } satisfies Pick<ScriptedDuelFixture, "options" | "decks">;
    const materialUids = ["p0-deck-100-0", "p0-deck-300-1"];
    const fixtures: ScriptedDuelFixture[] = [
      {
        ...fixtureBase,
        name: "fusion fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["900"] } },
        responses: [makeScriptedStep(makeResponseSelector("fusionSummon", 0, { code: "900", location: "extraDeck", materialUids }))],
        expected: { locations: { monsterZone: ["900"], graveyard: ["100", "300"] }, logIncludes: ["Fusion Summoned"] },
      },
      {
        ...fixtureBase,
        name: "synchro fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["910"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("synchroSummon", 0, { code: "910", location: "extraDeck", materialUids }))],
        expected: { locations: { monsterZone: ["910"], graveyard: ["100", "300"] }, logIncludes: ["Synchro Summoned"] },
      },
      {
        ...fixtureBase,
        name: "xyz fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["920"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("xyzSummon", 0, { code: "920", location: "extraDeck", materialUids }))],
        expected: { locations: { monsterZone: ["920"], overlay: ["100", "300"] }, logIncludes: ["Xyz Summoned"] },
      },
      {
        ...fixtureBase,
        name: "link fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["930"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("linkSummon", 0, { code: "930", location: "extraDeck", materialUids }))],
        expected: { locations: { monsterZone: ["930"], graveyard: ["100", "300"] }, logIncludes: ["Link Summoned"] },
      },
      {
        ...fixtureBase,
        name: "ritual fixture",
        options: { seed: 3, startingHandSize: 3 },
        decks: { ...fixtureBase.decks, 0: { main: ["100", "300", "940"] } },
        responses: [makeScriptedStep(makeResponseSelector("ritualSummon", 0, { code: "940", location: "hand", materialUids }))],
        expected: { locations: { monsterZone: ["940"], graveyard: ["100", "300"] }, logIncludes: ["Ritual Summoned"] },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
    }
  });
});
