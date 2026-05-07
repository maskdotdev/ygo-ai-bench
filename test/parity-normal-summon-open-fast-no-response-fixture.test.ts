import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Normal Summon open fast-effect no-response fixture", () => {
  it("auto-resolves a post-summon open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast No Response Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Open No Response Quick After Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Open No Response Quick After Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "No Response Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal summon open fast no-response fixture",
      options: { seed: 265, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "400"] },
        1: { main: ["300", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "normal-summon-no-response-turn-open-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn no-response open quick after summon resolved",
          },
          {
            id: "normal-summon-no-response-opponent-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent no-response open quick after summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns a triggerless Normal Summon to turn-player open priority before post-summon fast effects",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "normal-summon-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "normal-summon-no-response-opponent-open-quick" },
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "normal-summon-no-response-opponent-open-quick", 1, "open"),
              {
                player: 0,
                label: "Summons",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "200", location: "hand" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "normal-summon-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-summon open fast-effect chain immediately when the opponent has no legal response",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summon-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "normal-summon-no-response-opponent-open-quick" },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "normal-summon-no-response-turn-open-quick", 2, "open"),
              absentWindowEffectGroup(1, "normal-summon-no-response-opponent-open-quick", 2, "open"),
              {
                player: 0,
                label: "Summons",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "200", location: "hand" }],
              },
            ],
            logIncludes: ["Turn no-response open quick after summon resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response post-summon open fast-effect chain",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summon-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "normal-summon-no-response-opponent-open-quick" },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "normal-summon-no-response-turn-open-quick", 2, "open"),
          absentWindowEffectGroup(1, "normal-summon-no-response-opponent-open-quick", 2, "open"),
          {
            player: 0,
            label: "Summons",
            windowId: 2,
            windowKind: "open",
            actions: [{ type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "200", location: "hand" }],
          },
        ],
        logIncludes: ["Turn no-response open quick after summon resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
