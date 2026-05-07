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

describe("EDOPro parity chain-resolution cross-player later-payload open-fast pass-handoff turn-response restore fixture", () => {
  it("reopens opponent response priority after the turn player responds from a restored open-fast handoff", () => {
    const firstEventCode = 0x10000041;
    const secondEventCode = 0x10000042;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload Open Fast Turn Response Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload Open Fast Turn Response Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload Open Fast Turn Response Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload Open Fast Turn Response Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload Open Fast Turn Response Opponent Chain Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Payload Open Fast Turn Response Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload Open Fast Turn Response Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Cross Payload Open Fast Turn Response Turn Open Quick", kind: "monster", attack: 1300, defense: 1300 },
      { code: "950", name: "Cross Payload Open Fast Turn Response Turn Chain Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "990", name: "Cross Payload Open Fast Turn Response Opponent Open Quick", kind: "monster", attack: 700, defense: 700 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload open-fast pass-handoff turn-response restore fixture",
      options: { seed: 399, startingHandSize: 7 },
      decks: {
        0: { main: ["100", "300", "500", "900", "950", "800", "800"] },
        1: { main: ["400", "600", "700", "990", "800", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-open-fast-turn-response-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "500", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: firstEventCode },
              { player: 1, code: "700", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: secondEventCode },
            ],
            logMessage: "Cross payload open-fast turn-response starter resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload open-fast turn-response turn trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-opponent-trigger",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: secondEventCode,
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 1, code: "600", from: "hand", to: "graveyard" },
              { player: 0, code: "950", from: "hand", to: "graveyard" },
            ],
            logMessage: "Cross payload open-fast turn-response opponent trigger resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-turn-open-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Cross payload open-fast turn-response turn open quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-turn-chain-quick",
            player: 0,
            code: "950",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-response turn chain quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-opponent-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload open-fast turn-response opponent chain quick should not resolve yet",
          },
          {
            id: "fixture-cross-payload-open-fast-turn-response-opponent-open-quick",
            player: 1,
            code: "990",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Cross payload open-fast turn-response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-response-starter" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-cross-payload-open-fast-turn-response-turn-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-payload-open-fast-turn-response-opponent-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-response-turn-open-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-turn-response-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player response priority after the opponent passes the open-fast handoff chain",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-cross-payload-open-fast-turn-response-turn-open-quick" }],
            chainPasses: [1],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-chain-quick", 1, 5),
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-open-quick" },
              { type: "activateTrigger", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-trigger", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-open-quick", 5, "chainResponse"),
              absentChainEffectGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-chain-quick", 5),
              absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-open-quick", 5, "chainResponse"),
              absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-trigger", "turnOptional", 5, "chainResponse"),
              absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-trigger", "opponentOptional", 5, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro reopens opponent response priority after the turn player chains from a restored SEGOC open-fast pass handoff",
        phase: "main1",
        windowId: 6,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-cross-payload-open-fast-turn-response-turn-open-quick", sourceUid: "p0-deck-900-3" },
          { player: 0, effectId: "fixture-cross-payload-open-fast-turn-response-turn-chain-quick", sourceUid: "p0-deck-950-4" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-chain-quick", 1, 6),
          chainPassGroup(1, 1, 6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-open-quick" },
          { type: "activateTrigger", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-turn-trigger", triggerBucket: "turnOptional" },
          { type: "activateTrigger", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-turn-response-opponent-trigger", triggerBucket: "opponentOptional" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-open-quick", 6, "chainResponse"),
          absentChainEffectGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-chain-quick", 6),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-open-quick", 6, "chainResponse"),
          absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-turn-response-turn-trigger", "turnOptional", 6, "chainResponse"),
          absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-turn-response-opponent-trigger", "opponentOptional", 6, "chainResponse"),
        ],
        locations: { graveyard: ["500", "700", "600", "950"], hand: ["100", "300", "900", "800", "800", "400", "990", "800", "800"] },
        logIncludes: [
          "Cross payload open-fast turn-response starter resolved",
          "Cross payload open-fast turn-response opponent trigger resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
