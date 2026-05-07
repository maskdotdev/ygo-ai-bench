import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity position change open fast-effect no-response fixture", () => {
  it("auto-resolves a post-position-change open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Unlocked No Response Position Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Position No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Position No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "position change open fast no-response fixture",
      options: { seed: 363, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "position-no-response-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn no-response open quick after position change resolved",
          },
          {
            id: "position-no-response-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent no-response open quick after position change should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePosition", 0, { code: "100", location: "monsterZone", position: "faceUpDefense" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns manual position changes to turn-player open priority before post-change fast effects",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            positionsChanged: ["p0-deck-100-0"],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "position-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "position-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "position-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
              },
              absentWindowEffectGroup(1, "position-no-response-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "position-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-position-change open fast-effect chain immediately when the opponent has no legal response",
            phase: "main1",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            positionsChanged: ["p0-deck-100-0"],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            absentLegalActions: [
              { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 2, windowKind: "open" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "position-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "position-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 2, windowKind: "open" }],
              },
              absentWindowEffectGroup(0, "position-no-response-turn-open-quick", 2, "open"),
              absentWindowEffectGroup(1, "position-no-response-opponent-open-quick", 2, "open"),
            ],
            logIncludes: ["Turn no-response open quick after position change resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response post-position-change open fast-effect chain",
        phase: "main1",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        positionsChanged: ["p0-deck-100-0"],
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        absentLegalActions: [
          { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 2, windowKind: "open" },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "position-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "position-no-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Actions",
            windowId: 2,
            windowKind: "open",
            actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 2, windowKind: "open" }],
          },
          absentWindowEffectGroup(0, "position-no-response-turn-open-quick", 2, "open"),
          absentWindowEffectGroup(1, "position-no-response-opponent-open-quick", 2, "open"),
        ],
        logIncludes: ["Turn no-response open quick after position change resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
