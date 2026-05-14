import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Pendulum Summon open fast-effect fixture", () => {
  it("returns triggerless Pendulum Summons to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Low Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1, attack: 1000, defense: 1000 },
      { code: "200", name: "Open Fast High Pendulum Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8, attack: 1000, defense: 1000 },
      { code: "300", name: "Open Fast Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1500, defense: 1500 },
      { code: "400", name: "Turn Pendulum Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Pendulum Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "pendulum summon open fast effect fixture",
      options: { seed: 281, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "400"] },
        1: { main: ["500", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "200", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "pendulum-summon-turn-open-quick",
            player: 0,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Pendulum Summon resolved",
          },
          {
            id: "pendulum-summon-opponent-open-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Pendulum Summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep({ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"], label: "Pendulum Summon selected open fast candidate" }, {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Pendulum Summons beside turn-player open fast effects before the Pendulum Summon is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "pendulumSummon", player: 0, windowId: 0, windowKind: "open", summonUids: ["p0-deck-300-2"], count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"] },
              ], 1, 0),
              turnGroup(0),
            ],
            locations: { spellTrapZone: ["100", "200"], hand: ["300"], graveyard: ["400", "500"] },
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "pendulum-summon-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "pendulum-summon-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Pendulum Summons to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], graveyard: ["400", "500"] },
            cards: [{ uid: "p0-deck-300-2", code: "300", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "pendulumSummon", player: 0, windowId: 1, windowKind: "open", summonUids: ["p0-deck-300-2"] },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "pendulum-summon-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"] }, 1),
              absentWindowEffectGroup(1, "pendulum-summon-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a triggerless Pendulum Summon",
        phase: "main1",
        windowId: 1,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["300"], spellTrapZone: ["100", "200"], graveyard: ["400", "500"] },
        cards: [{ uid: "p0-deck-300-2", code: "300", location: "monsterZone", position: "faceUpAttack", faceUp: true }],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "pendulum-summon-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "pendulumSummon", player: 0, windowId: 1, windowKind: "open", summonUids: ["p0-deck-300-2"] },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "pendulum-summon-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "pendulumSummon", player: 0, summonUids: ["p0-deck-300-2"] }, 1),
          absentWindowEffectGroup(1, "pendulum-summon-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
