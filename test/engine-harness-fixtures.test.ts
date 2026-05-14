import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows, parseBanlistConf, scriptFilenameForCard, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentNormalSummonGroup, chainEffectGroup, chainPassGroup, normalSummonGroup, triggerActivationGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro compatibility harness fixtures", () => {
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
          legalActionGroups: [normalSummonGroup(0, "100", "hand")],
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
              absentLegalActionGroups: [absentNormalSummonGroup(0, "100", "hand")],
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
              legalActionGroups: [normalSummonGroup(0, "100", "hand", 1, 0)],
            },
            after: {
              source: "edopro",
              windowId: 1,
              windowKind: "open",
              waitingFor: 0,
              phase: "main1",
              locations: { monsterZone: ["100"] },
              absentLegalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowId: 1, windowKind: "open" }],
              absentLegalActionGroups: [absentNormalSummonGroup(0, "100", "hand", 1)],
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

  it("snapshot-restores setup move event packets", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "setup move event packet fixture",
        options: { seed: 16, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          moveCards: [
            {
              player: 0,
              code: "100",
              from: "hand",
              to: "graveyard",
              collectEvent: "sentToGraveyard",
              eventPlayer: 0,
              eventValue: 1,
              eventReason: 64,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p1-deck-200-0",
              eventReasonEffectId: 8101,
              relatedEffectId: 8102,
              eventChainDepth: 1,
              eventChainLinkId: "setup-origin-link",
              eventUids: ["p0-deck-100-0", "p1-deck-200-0"],
            },
          ],
        },
        before: {
          source: "edopro",
          windowId: 0,
          windowKind: "open",
          waitingFor: 0,
          locations: { graveyard: ["100"] },
          eventHistory: [
            {
              eventName: "sentToGraveyard",
              eventPlayer: 0,
              eventValue: 1,
              eventReason: 64,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p1-deck-200-0",
              eventReasonEffectId: 8101,
              relatedEffectId: 8102,
              eventChainDepth: 1,
              eventChainLinkId: "setup-origin-link",
              eventUids: ["p0-deck-100-0", "p1-deck-200-0"],
              eventCardUid: "p0-deck-100-0",
              eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
              eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
            snapshotRestore: "before",
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 1,
          phase: "battle",
          locations: { graveyard: ["100"] },
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

  it("rejects malformed setup move occurrence indexes", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed setup move occurrence fixture",
        options: { seed: 51, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "graveyard", occurrence: Number.NaN }],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          fixture: "malformed setup move occurrence fixture",
          message: "setup.moveCards[0].occurrence has malformed value NaN",
        },
      ],
    });
  });

  it("rejects malformed setup effect source occurrence indexes", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed setup effect occurrence fixture",
        options: { seed: 52, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          effects: [
            {
              id: "malformed-source-occurrence",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              occurrence: -1,
            },
          ],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          fixture: "malformed setup effect occurrence fixture",
        message: "Setup effect malformed-source-occurrence effect.occurrence has malformed value -1",
        },
      ],
    });
  });

  it("rejects malformed effect move occurrence indexes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fixture Ignition", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Fixture Move Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Fixture Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const result = runScriptedDuelFixture(
      {
        name: "malformed effect move occurrence fixture",
        options: { seed: 53, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "300"] },
        },
        setup: {
          effects: [
            {
              id: "malformed-move-occurrence",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              moveCardsOnResolve: [{ player: 0, code: "200", from: "hand", to: "graveyard", occurrence: 1.5 }],
            },
          ],
        },
        responses: [makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "malformed-move-occurrence" }))],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed effect move occurrence fixture",
        message: "Setup effect malformed-move-occurrence moveCardsOnResolve[0].occurrence has malformed value 1.5",
      },
    ]);
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
          makeScriptedStep(makeResponseSelector("passChain", 0)),
        ],
        expected: {
          source: "edopro",
          windowId: 4,
          phase: "main1",
          waitingFor: 0,
          chain: [],
          pendingTriggers: [],
          prompt: null,
          locations: { monsterZone: ["100"], hand: ["300", "500"] },
          logIncludes: ["Fixture self fast quick resolved", "Fixture trigger resolved"],
          legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
          legalActionGroups: [turnGroup(4)],
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

  it("rejects malformed location expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed location expectation fixture",
        options: { seed: 51, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          locations: { bogus: ["100"] } as never,
          locationCounts: { graveyard: { "100": Number.NaN }, nowhere: { "200": 0 } } as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed location expectation fixture",
        message: "before fixture (edopro): Expected locations has malformed location bogus",
      },
      {
        fixture: "malformed location expectation fixture",
        message: "before fixture (edopro): Expected 100 in graveyard has malformed count NaN",
      },
      {
        fixture: "malformed location expectation fixture",
        message: "before fixture (edopro): Expected locationCounts has malformed location nowhere",
      },
    ]);
  });

  it("rejects malformed list expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed list expectation fixture",
        options: { seed: 52, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          lastDiceResults: [Number.NaN],
          chainPasses: [2] as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected lastDiceResults[0] has malformed value NaN",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected chainPasses[0] has malformed player 2",
      },
    ]);
  });

  it("rejects malformed string expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed string expectation fixture",
        options: { seed: 55, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          usedCountKeys: [100] as never,
          logIncludes: [false] as never,
          locations: { hand: [100] } as never,
          battlePairs: [{ attackerUid: 100, targetUid: false }] as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed string expectation fixture", message: "before fixture (edopro): Expected usedCountKeys[0] has malformed value 100" },
      { fixture: "malformed string expectation fixture", message: "before fixture (edopro): Expected logIncludes[0] has malformed value false" },
      { fixture: "malformed string expectation fixture", message: "before fixture (edopro): Expected locations[hand] has malformed code 100" },
      { fixture: "malformed string expectation fixture", message: "before fixture (edopro): Expected battlePairs[0].attackerUid has malformed value 100" },
    ]);
  });

  it("rejects malformed scalar number expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed scalar number fixture",
        options: { seed: 53, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          status: "bogus" as "awaiting",
          winner: 2 as never,
          winReason: Number.NaN,
          windowId: Number.NaN,
          windowKind: "bogus" as "open",
          phase: "bogus" as "main1",
          battleStep: "bogus" as "attack",
          turn: -1,
          randomCounter: 0.5,
          activityCounts: { 0: { bogus: 1 }, 1: { attack: Number.NaN }, 2: { summon: 1 } } as never,
          skippedPhases: [{ player: 2, phase: "combat", remaining: 0 }] as never,
          phaseActivity: "yes" as never,
          attackCostPaid: Number.POSITIVE_INFINITY,
          options: { startingHandSize: Number.NaN, bogus: 1 } as never,
          duelTypeFlags: Number.NaN,
          globalFlags: -1,
          unofficialProcEnabled: "yes" as never,
          shuffleCheckDisabled: "yes" as never,
          pendingBattle: "yes" as never,
          currentAttack: "yes" as never,
          logCount: -1,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected status has malformed value bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected winner has malformed value 2" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected winReason has malformed value NaN" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected windowId has malformed value NaN" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected windowKind has malformed value bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected turn has malformed value -1" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected phase has malformed value bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected randomCounter has malformed value 0.5" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected player 0 activityCounts has malformed activity bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected player 1 activity attack has malformed count NaN" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected activityCounts has malformed player 2" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected skippedPhases[0].player has malformed player 2" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected skippedPhases[0].phase has malformed value combat" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected skippedPhases[0].remaining has malformed value 0" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected phaseActivity has malformed value yes" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected attackCostPaid has malformed value Infinity" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected options.startingHandSize has malformed value NaN" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected options has malformed key bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected duelTypeFlags has malformed value NaN" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected globalFlags has malformed value -1" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected unofficialProcEnabled has malformed value yes" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected shuffleCheckDisabled has malformed value yes" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected battleStep has malformed value bogus" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected pendingBattle has malformed value yes" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected currentAttack has malformed value yes" },
      { fixture: "malformed scalar number fixture", message: "before fixture (edopro): Expected logCount has malformed value -1" },
    ]);
  });

  it("rejects malformed scalar player expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed scalar player fixture",
        options: { seed: 54, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          waitingFor: 2 as never,
          turnPlayer: -1 as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed scalar player fixture", message: "before fixture (edopro): Expected waitingFor has malformed player 2" },
      { fixture: "malformed scalar player fixture", message: "before fixture (edopro): Expected turnPlayer has malformed player -1" },
    ]);
  });

  it("rejects malformed battle window expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed battle window fixture",
        options: { seed: 56, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          battleWindow: {
            id: Number.NaN,
            kind: "combat" as never,
            step: "declare" as never,
            attackerUid: 100 as never,
            targetUid: false as never,
            responsePlayer: 2 as never,
            attackNegated: "yes" as never,
            bogus: 1,
          } as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.id has malformed value NaN" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.kind has malformed value combat" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.step has malformed value declare" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.attackerUid has malformed value 100" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.targetUid has malformed value false" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.responsePlayer has malformed player 2" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow.attackNegated has malformed value yes" },
      { fixture: "malformed battle window fixture", message: "before fixture (edopro): Expected battleWindow has malformed key bogus" },
    ]);
  });

  it("rejects malformed prompt expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed prompt fixture",
        options: { seed: 57, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          prompt: {
            id: 100,
            type: "choose" as never,
            player: 2,
            options: [1, Number.NaN],
            description: -1,
            returnTo: -1,
            bogus: 1,
          } as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.id has malformed value 100" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.type has malformed value choose" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.player has malformed player 2" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.options[1] has malformed value NaN" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.description has malformed value -1" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt.returnTo has malformed player -1" },
      { fixture: "malformed prompt fixture", message: "before fixture (edopro): Expected prompt has malformed key bogus" },
    ]);
  });

  it("rejects malformed trigger order prompt expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed trigger order prompt fixture",
        options: { seed: 58, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          triggerOrderPrompt: {
            id: 100,
            type: "choose" as never,
            player: 2,
            triggerBucket: "later" as never,
            triggerIds: ["ok", false],
            bogus: 1,
          } as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt.id has malformed value 100" },
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt.type has malformed value choose" },
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt.player has malformed player 2" },
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt.triggerBucket has malformed value later" },
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt.triggerIds[1] has malformed value false" },
      { fixture: "malformed trigger order prompt fixture", message: "before fixture (edopro): Expected triggerOrderPrompt has malformed key bogus" },
    ]);
  });

  it("rejects malformed legal action group trigger metadata expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed legal action group trigger metadata fixture",
        options: { seed: 59, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          legalActionGroups: [
            {
              player: 0,
              triggerBucket: { player: 2, triggerBucket: "later", triggerIds: ["ok", false], bogus: 1 } as never,
              triggerOrderPrompt: {
                id: 100,
                type: "choose",
                player: -1,
                triggerBucket: "later",
                triggerIds: ["ok", false],
                bogus: 1,
              } as never,
            },
          ],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerBucket has malformed key bogus',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerBucket.triggerBucket has malformed value later',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerBucket.player has malformed player 2',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerBucket.triggerIds[1] has malformed value false',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt has malformed key bogus',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt.id has malformed value 100',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt.type has malformed value choose',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt.player has malformed player -1',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt.triggerBucket has malformed value later',
      },
      {
        fixture: "malformed legal action group trigger metadata fixture",
        message:
          'before fixture (edopro): Expected legal action group player=0 triggerBucket={"player":2,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt={"id":100,"type":"choose","player":-1,"triggerBucket":"later","triggerIds":["ok",false],"bogus":1} triggerOrderPrompt.triggerIds[1] has malformed value false',
      },
    ]);
  });

});
