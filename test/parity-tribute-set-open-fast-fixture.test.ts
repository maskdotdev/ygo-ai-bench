import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Tribute Set open fast-effect fixture", () => {
  it("returns triggerless Tribute Sets to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Tribute Set", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Open Fast Tribute Set Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Tribute Set Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Tribute Set Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "tribute set open fast effect fixture",
      options: { seed: 275, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "tribute-set-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Tribute Set resolved",
          },
          {
            id: "tribute-set-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Tribute Set should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSet", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Tribute Set actions beside turn-player open fast effects before the Tribute Set is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 },
              { type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "200", location: "monsterZone", position: "faceUpDefense", count: 1 },
              { type: "tributeSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", tributeUids: ["p0-deck-200-1"], count: 1 },
              { type: "tributeSet", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", tributeUids: ["p0-deck-200-1"], count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 }],
              },
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "200", location: "monsterZone", position: "faceUpDefense", count: 1 }],
              },
              summonGroup([
                { type: "tributeSummon", player: 0, code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] },
                { type: "tributeSet", player: 0, code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "tribute-set-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "tribute-set-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Tribute Sets to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["200", "300", "400"] },
            cards: [
              { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "tribute-set-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(1, "tribute-set-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Tribute Set",
        phase: "main1",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["200", "300", "400"] },
        cards: [
          { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-set-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
          { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "tribute-set-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
          absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
          absentWindowEffectGroup(1, "tribute-set-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
