import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Flip Summon open fast-effect fixture", () => {
  it("returns triggerless Flip Summons to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Flippable Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Flip Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Flip Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "flip summon open fast effect fixture",
      options: { seed: 273, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "flip-summon-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Flip Summon resolved",
          },
          {
            id: "flip-summon-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Flip Summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Flip Summon actions beside turn-player open fast effects before the Flip Summon is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 },
              { type: "flipSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "monsterZone", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 }],
              },
              summonGroup([{ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "flip-summon-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "flip-summon-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Flip Summons to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "flipSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "monsterZone" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "flip-summon-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 1),
              absentWindowEffectGroup(1, "flip-summon-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Flip Summon",
        phase: "main1",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "flip-summon-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "flipSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "monsterZone" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "flip-summon-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }, 1),
          absentWindowEffectGroup(1, "flip-summon-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
