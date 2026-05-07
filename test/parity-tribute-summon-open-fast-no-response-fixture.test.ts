import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Tribute Summon open fast-effect no-response fixture", () => {
  it("auto-resolves a post-Tribute-Summon open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Tribute No Response Summon", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Open Fast Tribute No Response Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Tribute No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Tribute No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "tribute summon open fast no-response fixture",
      options: { seed: 365, startingHandSize: 3 },
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
            id: "tribute-summon-no-response-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn no-response open quick after Tribute Summon resolved",
          },
          {
            id: "tribute-summon-no-response-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent no-response open quick after Tribute Summon should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSummon", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns triggerless Tribute Summons to turn-player open priority before post-summon fast effects",
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
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "tribute-summon-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "tributeSummon", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "tributeSet", player: 0, windowId: 1, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "tribute-summon-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 1),
              absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 1),
              absentWindowEffectGroup(1, "tribute-summon-no-response-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "tribute-summon-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-Tribute-Summon open fast-effect chain immediately when the opponent has no legal response",
            phase: "main1",
            windowId: 2,
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
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            absentLegalActions: [
              { type: "tributeSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
              { type: "tributeSet", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "tribute-summon-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "tribute-summon-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 2),
              absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 2),
              absentWindowEffectGroup(0, "tribute-summon-no-response-turn-open-quick", 2, "open"),
              absentWindowEffectGroup(1, "tribute-summon-no-response-opponent-open-quick", 2, "open"),
            ],
            logIncludes: ["Turn no-response open quick after Tribute Summon resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response post-Tribute-Summon open fast-effect chain",
        phase: "main1",
        windowId: 2,
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
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        absentLegalActions: [
          { type: "tributeSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
          { type: "tributeSet", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "tribute-summon-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "tribute-summon-no-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 2),
          absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 2),
          absentWindowEffectGroup(0, "tribute-summon-no-response-turn-open-quick", 2, "open"),
          absentWindowEffectGroup(1, "tribute-summon-no-response-opponent-open-quick", 2, "open"),
        ],
        logIncludes: ["Turn no-response open quick after Tribute Summon resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
