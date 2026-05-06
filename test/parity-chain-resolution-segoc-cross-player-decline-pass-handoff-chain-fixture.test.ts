import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentTriggerActivationGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player SEGOC decline pass handoff chain fixture", () => {
  it("opens opponent responses after the trigger player chains from a cross-player post-decline handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Decline Handoff Chain Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Turn Cross Decline Handoff Chain Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "300", name: "Cross Decline Handoff Chain Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Decline Handoff Chain Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Decline Handoff Chain Turn Optional", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Decline Handoff Chain Opponent Optional", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Decline Handoff Chain Moved Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Opponent Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Opponent Cross Decline Handoff Chain Quick", kind: "monster", attack: 1600, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution cross-player segoc decline pass handoff chain fixture",
      options: { seed: 299, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "500", "700"] },
        1: { main: ["400", "600", "900", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-decline-handoff-chain-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "700", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard" },
              { player: 0, code: "200", from: "hand", to: "graveyard" },
              { player: 1, code: "900", from: "hand", to: "graveyard" },
            ],
            logMessage: "Cross decline handoff chain starter resolved",
          },
          {
            id: "fixture-cross-decline-handoff-chain-turn-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            optional: false,
            range: ["hand"],
            logMessage: "Cross decline handoff chain turn mandatory should not resolve yet",
          },
          {
            id: "fixture-cross-decline-handoff-chain-opponent-mandatory",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            optional: false,
            range: ["hand"],
            logMessage: "Cross decline handoff chain opponent mandatory should not resolve yet",
          },
          {
            id: "fixture-cross-decline-handoff-chain-turn-optional",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            range: ["hand"],
            logMessage: "Cross decline handoff chain turn optional should not resolve yet",
          },
          {
            id: "fixture-cross-decline-handoff-chain-opponent-optional",
            player: 1,
            code: "600",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            range: ["hand"],
            logMessage: "Cross decline handoff chain opponent optional should not resolve",
          },
          {
            id: "fixture-cross-decline-handoff-chain-turn-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross decline handoff chain turn quick should not resolve yet",
          },
          {
            id: "fixture-cross-decline-handoff-chain-opponent-quick",
            player: 1,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross decline handoff chain opponent quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-decline-handoff-chain-starter" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-decline-handoff-chain-turn-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-decline-handoff-chain-opponent-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-decline-handoff-chain-turn-optional" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-cross-decline-handoff-chain-opponent-optional" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-decline-handoff-chain-turn-quick" }), { snapshotRestore: "both" }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent response priority after the trigger player chains from a cross-player post-decline SEGOC pass handoff",
        phase: "main1",
        windowId: 7,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-cross-decline-handoff-chain-turn-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 1, effectId: "fixture-cross-decline-handoff-chain-opponent-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 0, effectId: "fixture-cross-decline-handoff-chain-turn-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 0, effectId: "fixture-cross-decline-handoff-chain-turn-quick", sourceUid: "p0-deck-200-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-decline-handoff-chain-opponent-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 7, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-cross-decline-handoff-chain-opponent-quick", 1, 7),
          chainPassGroup(1, 1, 7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-decline-handoff-chain-turn-quick" },
          {
            type: "activateTrigger",
            player: 1,
            windowId: 7,
            windowKind: "triggerBucket",
            effectId: "fixture-cross-decline-handoff-chain-opponent-optional",
            triggerBucket: "opponentOptional",
          },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(0, "fixture-cross-decline-handoff-chain-turn-quick", 7),
          absentTriggerActivationGroup(1, "fixture-cross-decline-handoff-chain-opponent-optional", "opponentOptional", 7, "triggerBucket"),
        ],
        locations: { graveyard: ["700", "200", "900"], hand: ["100", "300", "500", "400", "600", "800", "800"] },
        logIncludes: ["Cross decline handoff chain starter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
