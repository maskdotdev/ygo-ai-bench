import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows, parseBanlistConf, scriptFilenameForCard, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, triggerActivationGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

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
          windowKind: "open",
          waitingFor: 0,
          phase: "main1",
          legalActionCounts: { 0: 6, 1: 0 },
          legalActionGroupCounts: { 0: 2, 1: 0 },
          legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", count: 1 }],
          legalActionGroups: [{ player: 0, label: "Summons", windowKind: "open", actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", count: 1 }] }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              windowId: 1,
              windowKind: "open",
              waitingFor: 0,
              phase: "main1",
              legalActionCounts: { 0: 2 },
              legalActionGroupCounts: { 0: 1 },
              absentLegalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand" }],
              absentLegalActionGroups: [{ player: 0, label: "Summons", windowKind: "open", actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand" }] }],
              legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              legalActionGroups: [turnGroup(1)],
              logCount: 6,
              logIncludes: ["Normal Summoned"],
            },
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 1,
          locations: { monsterZone: ["100"] },
          logCount: 6,
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("continues scripted fixtures from restored snapshots", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "restore before response fixture",
        options: { seed: 14, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "400"] },
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: "before",
            before: {
              source: "edopro",
              windowId: 0,
              windowKind: "open",
              waitingFor: 0,
              phase: "main1",
              legalActionCounts: { 0: 6, 1: 0 },
              legalActionGroupCounts: { 0: 2, 1: 0 },
              legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 }],
              legalActionGroups: [{ player: 0, label: "Summons", windowId: 0, windowKind: "open", actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 }] }],
            },
            after: {
              source: "edopro",
              windowId: 1,
              windowKind: "open",
              waitingFor: 0,
              phase: "main1",
              locations: { monsterZone: ["100"] },
              absentLegalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 1, windowKind: "open" }],
              absentLegalActionGroups: [{ player: 0, label: "Summons", windowId: 1, windowKind: "open", actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 1, windowKind: "open" }] }],
              legalActionCounts: { 0: 2 },
              legalActionGroupCounts: { 0: 1 },
            },
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 1,
          windowKind: "open",
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
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
          source: "edopro",
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
              legalActionGroups: [triggerActivationGroup(0, "fixture-normal-summon-trigger", "turnOptional", 1, 1)],
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
              legalActionGroups: [chainEffectGroup(0, "fixture-self-fast-quick", 1, 2), chainPassGroup(0, 1, 2)],
              absentLegalActions: [{ type: "activateEffect", player: 1 }],
              absentLegalActionGroups: [absentChainEffectGroup(1, "fixture-self-fast-quick")],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-self-fast-quick" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              windowId: 2,
              waitingFor: 0,
              legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "fixture-self-fast-quick", count: 1 }],
              legalActionGroups: [chainEffectGroup(0, "fixture-self-fast-quick", 1, 2)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 3,
          phase: "main1",
          waitingFor: 0,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          locations: { monsterZone: ["100"], hand: ["300", "500"] },
          logIncludes: ["Fixture self fast quick resolved", "Fixture trigger resolved"],
          legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
          legalActionGroups: [turnGroup(3)],
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
              legalActionGroups: [chainEffectGroup(1, "fixture-opponent-fast-quick", 1, 2), chainPassGroup(1, 1, 2)],
              absentLegalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-turn-fast-quick" }],
              absentLegalActionGroups: [absentChainEffectGroup(0, "fixture-turn-fast-quick")],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-fast-quick" }), {
            snapshotRestore: true,
            before: {
              source: "edopro",
              windowId: 2,
              waitingFor: 1,
              legalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "fixture-opponent-fast-quick", count: 1 }],
              legalActionGroups: [chainEffectGroup(1, "fixture-opponent-fast-quick", 1, 2)],
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
              legalActionGroups: [chainEffectGroup(0, "fixture-turn-fast-quick", 1, 3), chainPassGroup(0, 1, 3)],
            },
          }),
          makeScriptedStep(makeResponseSelector("passChain", 0)),
          makeScriptedStep(makeResponseSelector("passChain", 1)),
        ],
        expected: {
          source: "edopro",
          windowId: 5,
          phase: "main1",
          waitingFor: 0,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          locations: { monsterZone: ["100"], hand: ["300", "500"] },
          logIncludes: ["Fixture opponent fast quick resolved", "Fixture trigger resolved"],
          legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
          legalActionGroups: [turnGroup(5)],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

});
