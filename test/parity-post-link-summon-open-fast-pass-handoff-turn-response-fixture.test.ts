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

describe("EDOPro parity post-Link-Summon open fast-effect pass handoff turn response fixture", () => {
  it("reopens turn-player chain responses after the opponent passes a post-Link-Summon open fast chain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Link Handoff Material A", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Post Link Handoff Material B", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Link Handoff Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Link Handoff Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Link Handoff Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Link Handoff Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Link Handoff Link Monster", kind: "extra", typeFlags: 0x4000001, level: 2, attack: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post link summon open fast pass handoff turn response fixture",
      options: { seed: 430, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "600"], extra: ["900"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-link-summon-handoff-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Post Link Summon handoff turn open quick resolved",
          },
          {
            id: "post-link-summon-handoff-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Post Link Summon handoff turn chain quick resolved",
          },
          {
            id: "post-link-summon-handoff-opponent-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Post Link Summon handoff opponent chain quick should not resolve",
          },
          {
            id: "post-link-summon-handoff-opponent-open-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Post Link Summon handoff opponent open quick should not resolve",
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
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "post-link-summon-handoff-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "post-link-summon-handoff-turn-open-quick", count: 1 }],
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
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "post-link-summon-handoff-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "post-link-summon-handoff-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "post-link-summon-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "post-link-summon-handoff-turn-chain-quick", 0, "open"),
              absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-chain-quick", 0, "open"),
              absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-open-quick", 0, "open"),
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
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-link-summon-handoff-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-link-summon-handoff-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "linkSummon", player: 0, windowId: 1, windowKind: "open", code: "900", location: "extraDeck" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-link-summon-handoff-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-link-summon-handoff-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-link-summon-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 1),
              absentWindowEffectGroup(0, "post-link-summon-handoff-turn-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-link-summon-handoff-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player chain-only responses after the opponent passes a post-Link-Summon open fast-effect chain",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "post-link-summon-handoff-turn-open-quick", sourceUid: "p0-deck-300-2" }],
            chainPasses: [1],
            locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
            cards: [
              { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
              { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
              { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-link-summon-handoff-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-link-summon-handoff-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-link-summon-handoff-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-link-summon-handoff-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-link-summon-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-link-summon-handoff-turn-open-quick", 3),
              absentChainEffectGroup(1, "post-link-summon-handoff-opponent-chain-quick", 3),
              absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-link-summon-handoff-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves post-Link-Summon pass-handoff chains back to turn-player open priority after the opponent passes the reopened response window",
        phase: "main1",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["900"], graveyard: ["100", "200", "300", "600", "400", "500"] },
        cards: [
          { uid: "p0-extraDeck-900-0", code: "900", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-100-0", code: "100", location: "graveyard" },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "linkSummon", player: 0, windowId: 5, windowKind: "open", code: "900", location: "extraDeck" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-link-summon-handoff-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "post-link-summon-handoff-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "post-link-summon-handoff-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "post-link-summon-handoff-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "linkSummon", player: 0, code: "900", location: "extraDeck" }, 5),
          absentWindowEffectGroup(0, "post-link-summon-handoff-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "post-link-summon-handoff-turn-chain-quick", 5, "open"),
          absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-chain-quick", 5, "open"),
          absentWindowEffectGroup(1, "post-link-summon-handoff-opponent-open-quick", 5, "open"),
        ],
        logIncludes: [
          "Post Link Summon handoff turn chain quick resolved",
          "Post Link Summon handoff turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
