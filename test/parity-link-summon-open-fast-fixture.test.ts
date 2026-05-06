import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Link Summon open fast-effect fixture", () => {
  it("returns triggerless Link Summons to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Link Material A", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Fast Link Material B", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Link Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Link Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Open Fast Link Monster", kind: "extra", typeFlags: 0x4000001, level: 2, attack: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "link summon open fast effect fixture",
      options: { seed: 278, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"], extra: ["900"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "link-summon-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Link Summon resolved",
          },
          {
            id: "link-summon-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Link Summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("linkSummon", 0, { code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"] }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Link Summons beside turn-player open fast effects before the Link Summon is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 },
              { type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "100", location: "monsterZone", position: "faceUpDefense", count: 1 },
              { type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "200", location: "monsterZone", position: "faceUpDefense", count: 1 },
              { type: "linkSummon", player: 0, windowId: 0, windowKind: "open", code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"], count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 }],
              },
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "100", location: "monsterZone", position: "faceUpDefense", count: 1 },
                  { type: "changePosition", player: 0, windowId: 0, windowKind: "open", code: "200", location: "monsterZone", position: "faceUpDefense", count: 1 },
                ],
              },
              summonGroup([{ type: "linkSummon", player: 0, code: "900", location: "extraDeck", materialUids: ["p0-deck-100-0", "p0-deck-200-1"] }], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "link-summon-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "link-summon-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Link Summons to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "400"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "linkSummon", player: 0, windowId: 1, windowKind: "open", code: "900", location: "extraDeck" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "link-summon-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 1),
              absentWindowEffectGroup(1, "link-summon-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Link Summon",
        phase: "main1",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "400"] },
        cards: [
          { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "linkSummon", player: 0, windowId: 1, windowKind: "open", code: "900", location: "extraDeck" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "link-summon-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 1),
          absentWindowEffectGroup(1, "link-summon-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
