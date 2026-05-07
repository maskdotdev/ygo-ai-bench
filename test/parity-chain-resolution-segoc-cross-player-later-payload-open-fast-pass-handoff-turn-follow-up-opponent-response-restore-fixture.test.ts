import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player later-payload open-fast pass-handoff turn-follow-up opponent-response restore fixture", () => {
  it("reopens opponent response priority after the turn player follows up from a restored handoff chain", () => {
    const firstEventCode = 0x10000045;
    const secondEventCode = 0x10000046;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload Open Fast Turn Follow-Up Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload Open Fast Turn Follow-Up Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload Open Fast Turn Follow-Up Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload Open Fast Turn Follow-Up Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload Open Fast Turn Follow-Up Opponent First Chain Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "620", name: "Cross Payload Open Fast Turn Follow-Up Opponent Second Chain Quick", kind: "monster", attack: 1150, defense: 1150 },
      { code: "700", name: "Cross Payload Open Fast Turn Follow-Up Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload Open Fast Turn Follow-Up Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Cross Payload Open Fast Turn Follow-Up Turn Open Quick", kind: "monster", attack: 1300, defense: 1300 },
      { code: "950", name: "Cross Payload Open Fast Turn Follow-Up Turn Chain Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "970", name: "Cross Payload Open Fast Turn Follow-Up Turn Follow-Up Quick", kind: "monster", attack: 1450, defense: 1450 },
      { code: "990", name: "Cross Payload Open Fast Turn Follow-Up Opponent Open Quick", kind: "monster", attack: 700, defense: 700 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload open-fast pass-handoff turn-follow-up opponent-response restore fixture",
      options: { seed: 402, startingHandSize: 7 },
      decks: {
        0: { main: ["100", "300", "500", "900", "950", "970", "800"] },
        1: { main: ["400", "600", "620", "700", "990", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "500", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: firstEventCode },
              { player: 1, code: "700", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: secondEventCode },
            ],
            logMessage: "Cross payload open-fast turn-follow-up starter resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload open-fast turn-follow-up turn trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-opponent-trigger",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: secondEventCode,
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 1, code: "600", from: "hand", to: "graveyard" },
              { player: 1, code: "620", from: "hand", to: "graveyard" },
              { player: 0, code: "950", from: "hand", to: "graveyard" },
              { player: 0, code: "970", from: "hand", to: "graveyard" },
            ],
            logMessage: "Cross payload open-fast turn-follow-up opponent trigger resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-turn-open-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Cross payload open-fast turn-follow-up turn open quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-turn-chain-quick",
            player: 0,
            code: "950",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-follow-up turn chain quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-turn-follow-up-quick",
            player: 0,
            code: "970",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-follow-up turn follow-up quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-opponent-first-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-follow-up opponent first chain quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-opponent-second-chain-quick",
            player: 1,
            code: "620",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-follow-up opponent second chain quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-follow-up-opponent-open-quick",
            player: 1,
            code: "990",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Cross payload open-fast turn-follow-up opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-starter" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-open-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-first-chain-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-follow-up-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro reopens opponent response priority after the turn player follows up from a restored SEGOC open-fast handoff chain",
        phase: "main1",
        windowId: 8,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-open-quick", sourceUid: "p0-deck-900-3" },
          { player: 0, effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-chain-quick", sourceUid: "p0-deck-950-4" },
          { player: 1, effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-first-chain-quick", sourceUid: "p1-deck-600-1" },
          { player: 0, effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-follow-up-quick", sourceUid: "p0-deck-970-5" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-second-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 8, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-cross-payload-open-fast-turn-follow-up-opponent-second-chain-quick", 1, 8),
          chainPassGroup(1, 1, 8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-follow-up-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-open-quick" },
          { type: "activateTrigger", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-turn-trigger", triggerBucket: "turnOptional" },
          { type: "activateTrigger", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-follow-up-opponent-trigger", triggerBucket: "opponentOptional" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-turn-follow-up-turn-open-quick", 8, "chainResponse"),
          absentChainEffectGroup(0, "fixture-cross-payload-open-fast-turn-follow-up-turn-chain-quick", 8),
          absentChainEffectGroup(0, "fixture-cross-payload-open-fast-turn-follow-up-turn-follow-up-quick", 8),
          absentChainEffectGroup(1, "fixture-cross-payload-open-fast-turn-follow-up-opponent-first-chain-quick", 8),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-turn-follow-up-opponent-open-quick", 8, "chainResponse"),
          absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-turn-follow-up-turn-trigger", "turnOptional", 8, "chainResponse"),
          absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-turn-follow-up-opponent-trigger", "opponentOptional", 8, "chainResponse"),
        ],
        locations: { graveyard: ["500", "700", "600", "620", "950", "970"], hand: ["100", "300", "900", "800", "400", "990", "800"] },
        logIncludes: [
          "Cross payload open-fast turn-follow-up starter resolved",
          "Cross payload open-fast turn-follow-up opponent trigger resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
