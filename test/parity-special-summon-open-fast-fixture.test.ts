import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Special Summon open fast-effect fixtures", () => {
  it("returns a triggerless inherent Special Summon to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Special Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Open Quick After Special", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Open Quick After Special", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Special Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon open fast effect fixture",
      options: { seed: 264, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "400"] },
        1: { main: ["300", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "special-summon-procedure",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "special-summon-turn-open-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Turn open quick after special resolved",
          },
          {
            id: "special-summon-opponent-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open quick after special should not be offered",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "special-summon-procedure" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless inherent Special Summons to turn-player open priority with that player's open fast effects available",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            locations: { monsterZone: ["100"], hand: ["200", "300", "400", "400", "400"] },
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 1),
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "special-summon-opponent-open-quick" },
              { type: "specialSummonProcedure", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-procedure" },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless inherent Special Summon",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        legalActionCounts: { 0: 7, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-turn-open-quick", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 1,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-turn-open-quick", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 1),
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "special-summon-opponent-open-quick" },
          { type: "specialSummonProcedure", player: 0, windowId: 1, windowKind: "open", effectId: "special-summon-procedure" },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("opens opponent chain responses after a triggerless Special Summon open fast effect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Special Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Open Quick After Special", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Chain Quick After Special", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Normal Follow-up", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special summon open fast chain-response fixture",
      options: { seed: 265, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "400"] },
        1: { main: ["300", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "special-summon-chain-procedure",
            player: 0,
            code: "100",
            location: "hand",
            event: "summonProcedure",
            range: ["hand"],
          },
          {
            id: "special-summon-turn-open-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open quick after special chain resolved",
          },
          {
            id: "special-summon-opponent-chain-response-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain quick after special resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("specialSummonProcedure", 0, { code: "100", location: "hand", effectId: "special-summon-chain-procedure" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "special-summon-turn-open-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent chain-response priority after a post-special-summon open fast effect starts a chain",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "special-summon-turn-open-chain-quick", sourceUid: "p0-deck-200-1" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "special-summon-opponent-chain-response-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "special-summon-opponent-chain-response-quick", 1, 2), chainPassGroup(1, 1, 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-special-summon open fast-effect chain and returns to turn-player open priority",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 3),
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "special-summon-turn-open-chain-quick" },
              { type: "specialSummonProcedure", player: 0, windowId: 3, windowKind: "open", effectId: "special-summon-chain-procedure" },
            ],
            logIncludes: ["Turn open quick after special chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps turn-player open priority after resolving a post-special-summon open fast-effect chain",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "special-summon-turn-open-chain-quick" },
          { type: "specialSummonProcedure", player: 0, windowId: 3, windowKind: "open", effectId: "special-summon-chain-procedure" },
        ],
        logIncludes: ["Turn open quick after special chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
