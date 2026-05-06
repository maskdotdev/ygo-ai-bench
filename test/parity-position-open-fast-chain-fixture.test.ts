import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity position change open fast-effect chain fixture", () => {
  it("opens opponent chain responses after a position-change open fast effect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Unlocked Position Chain Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Position Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Position Chain Response", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Position Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "position change open fast chain-response fixture",
      options: { seed: 362, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "position-turn-open-chain-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open quick after position change chain resolved",
          },
          {
            id: "position-opponent-chain-response-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain quick after position change should not resolve",
          },
          {
            id: "position-opponent-open-chain-filtered",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after position change chain should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePosition", 0, { code: "100", location: "monsterZone", position: "faceUpDefense" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes manual position changes before turn-player open fast effects resolve",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            positionsChanged: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "position-turn-open-chain-quick", count: 1 },
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "position-turn-open-chain-quick", count: 1 }],
              },
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 }],
              },
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "position-opponent-chain-response-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "position-opponent-open-chain-filtered" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "position-opponent-chain-response-quick", 0, "open"),
              absentWindowEffectGroup(1, "position-opponent-open-chain-filtered", 0, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "position-turn-open-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent chain-response priority after a post-position-change open fast effect starts a chain",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "position-turn-open-chain-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            positionsChanged: ["p0-deck-100-0"],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpDefense", faceUp: true }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "position-opponent-chain-response-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "position-opponent-chain-response-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "position-opponent-open-chain-filtered" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "position-opponent-open-chain-filtered", 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps turn-player open priority after resolving a post-position-change open fast-effect chain",
        phase: "main1",
        windowId: 3,
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
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        absentLegalActions: [
          { type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 3, windowKind: "open" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "position-turn-open-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "position-opponent-chain-response-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "position-opponent-open-chain-filtered" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Actions",
            windowId: 3,
            windowKind: "open",
            actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 3, windowKind: "open" }],
          },
          absentWindowEffectGroup(0, "position-turn-open-chain-quick", 3, "open"),
          absentWindowEffectGroup(1, "position-opponent-chain-response-quick", 3, "open"),
          absentWindowEffectGroup(1, "position-opponent-open-chain-filtered", 3, "open"),
        ],
        logIncludes: ["Turn open quick after position change chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
