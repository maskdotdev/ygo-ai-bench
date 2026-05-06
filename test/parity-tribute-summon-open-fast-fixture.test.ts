import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Tribute Summon open fast-effect fixture", () => {
  it("returns triggerless Tribute Summons to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Tribute Summon", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Open Fast Tribute Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Tribute Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Tribute Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "tribute summon open fast effect fixture",
      options: { seed: 274, startingHandSize: 3 },
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
            id: "tribute-summon-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Tribute Summon resolved",
          },
          {
            id: "tribute-summon-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Tribute Summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSummon", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Tribute Summons beside turn-player open fast effects before the Tribute Summon is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 }],
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
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "tribute-summon-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "tribute-summon-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Tribute Summons to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["200", "300", "400"] },
            cards: [
              { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "tribute-summon-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(1, "tribute-summon-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Tribute Summon",
        phase: "main1",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["200", "300", "400"] },
        cards: [
          { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
          { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "tribute-summon-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
          absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
          absentWindowEffectGroup(1, "tribute-summon-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
