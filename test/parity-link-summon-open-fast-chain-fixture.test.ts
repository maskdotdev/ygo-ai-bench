import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentSummonGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Link Summon open fast-effect chain fixture", () => {
  it("opens opponent chain responses after a triggerless Link Summon open fast effect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Fast Link Chain Material A", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Fast Link Chain Material B", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Link Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Link Chain Response", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Link Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Open Fast Link Chain Monster", kind: "extra", typeFlags: 0x4000001, level: 2, attack: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "link summon open fast chain-response fixture",
      options: { seed: 369, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"], extra: ["900"] },
        1: { main: ["400", "500", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "link-summon-turn-open-chain-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open quick after Link Summon chain resolved",
          },
          {
            id: "link-summon-opponent-chain-response-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain quick after Link Summon should not resolve",
          },
          {
            id: "link-summon-opponent-open-chain-filtered",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Link Summon chain should not resolve",
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
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "link-summon-turn-open-chain-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "link-summon-turn-open-chain-quick", count: 1 }],
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
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "link-summon-opponent-chain-response-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "link-summon-opponent-open-chain-filtered" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "link-summon-opponent-chain-response-quick", 0, "open"),
              absentWindowEffectGroup(1, "link-summon-opponent-open-chain-filtered", 0, "open"),
            ],
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
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "400", "500"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-chain-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "link-summon-turn-open-chain-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "linkSummon", player: 0, windowId: 1, windowKind: "open", code: "900", location: "extraDeck" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "link-summon-opponent-chain-response-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "link-summon-opponent-open-chain-filtered" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 1),
              absentWindowEffectGroup(1, "link-summon-opponent-chain-response-quick", 1, "open"),
              absentWindowEffectGroup(1, "link-summon-opponent-open-chain-filtered", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "link-summon-turn-open-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent chain-response priority after a post-Link-Summon open fast effect starts a chain",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "link-summon-turn-open-chain-quick", sourceUid: "p0-deck-300-2" }],
            chainPasses: [],
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "400", "500"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "link-summon-opponent-chain-response-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "link-summon-opponent-chain-response-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "link-summon-opponent-open-chain-filtered" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "link-summon-opponent-open-chain-filtered", 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps turn-player open priority after resolving a post-Link-Summon open fast-effect chain",
        phase: "main1",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "400", "500"] },
        cards: [
          { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        absentLegalActions: [
          { type: "linkSummon", player: 0, windowId: 3, windowKind: "open", code: "900", location: "extraDeck" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "link-summon-turn-open-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "link-summon-opponent-chain-response-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "link-summon-opponent-open-chain-filtered" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 3),
          absentWindowEffectGroup(0, "link-summon-turn-open-chain-quick", 3, "open"),
          absentWindowEffectGroup(1, "link-summon-opponent-chain-response-quick", 3, "open"),
          absentWindowEffectGroup(1, "link-summon-opponent-open-chain-filtered", 3, "open"),
        ],
        logIncludes: ["Turn open quick after Link Summon chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
