import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Normal Summon open fast-effect fixtures", () => {
  it("returns a triggerless Normal Summon to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Open Quick After Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Open Quick After Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon open fast effect fixture",
      options: { seed: 263, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "400"] },
        1: { main: ["300", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "normal-summon-turn-open-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Turn open quick after summon resolved",
          },
          {
            id: "normal-summon-opponent-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open quick after summon should not be offered",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial turn-player open priority restorable before a triggerless Normal Summon",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "normal-summon-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "normal-summon-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Normal Summons to turn-player open priority with that player's open fast effects available",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "normal-summon-opponent-open-quick" },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "normal-summon-opponent-open-quick" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Normal Summon",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "normal-summon-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          {
            player: 1,
            label: "Effects",
            windowId: 1,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "normal-summon-opponent-open-quick" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
