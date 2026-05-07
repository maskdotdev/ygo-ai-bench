import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Monster Set open fast-effect no-response fixture", () => {
  it("auto-resolves a post-Monster-Set open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Settable No Response Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Monster Set No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Monster Set No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "monster set open fast no-response fixture",
      options: { seed: 373, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "monster-set-no-response-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn no-response open quick after Monster Set resolved",
          },
          {
            id: "monster-set-no-response-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent no-response open quick after Monster Set should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setMonster", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Monster Set actions beside turn-player open fast effects before the Set is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 5, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "monster-set-no-response-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "monster-set-no-response-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns Monster Sets to turn-player open priority before post-set fast effects",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["300", "400"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "normalSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "setMonster", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(1, "monster-set-no-response-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "monster-set-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the post-Monster-Set open fast-effect window before resolving the no-response chain",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["300", "400"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "normalSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "setMonster", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "monster-set-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "normalSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "setMonster", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(1, "monster-set-no-response-opponent-open-quick", 1, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-Monster-Set open fast-effect chain immediately when the opponent has no legal response",
            phase: "main1",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            locations: { monsterZone: ["100"], graveyard: ["300", "400"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            absentLegalActions: [
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "monster-set-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "normalSummon", player: 0, code: "100", location: "hand" }, 2),
              absentSummonGroup({ type: "setMonster", player: 0, code: "100", location: "hand" }, 2),
              absentWindowEffectGroup(0, "monster-set-no-response-turn-open-quick", 2, "open"),
              absentWindowEffectGroup(1, "monster-set-no-response-opponent-open-quick", 2, "open"),
            ],
            logIncludes: ["Turn no-response open quick after Monster Set resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response post-Monster-Set open fast-effect chain",
        phase: "main1",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["300", "400"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceDownDefense", faceUp: false }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        absentLegalActions: [
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "monster-set-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "monster-set-no-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "normalSummon", player: 0, code: "100", location: "hand" }, 2),
          absentSummonGroup({ type: "setMonster", player: 0, code: "100", location: "hand" }, 2),
          absentWindowEffectGroup(0, "monster-set-no-response-turn-open-quick", 2, "open"),
          absentWindowEffectGroup(1, "monster-set-no-response-opponent-open-quick", 2, "open"),
        ],
        logIncludes: ["Turn no-response open quick after Monster Set resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
