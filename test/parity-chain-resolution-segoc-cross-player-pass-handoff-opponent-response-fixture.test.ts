import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentTriggerActivationGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player SEGOC pass-handoff opponent-response fixture", () => {
  it("reopens turn-player responses after the opponent chains from a cross-player chain-created SEGOC handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Handoff Opponent Response Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Cross Handoff Opponent Response Turn Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "300", name: "Cross Handoff Opponent Response Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Handoff Opponent Response Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Handoff Opponent Response Turn Optional", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Handoff Opponent Response Opponent Optional", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Handoff Opponent Response Moved Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Handoff Opponent Response Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Cross Handoff Opponent Response Opponent Quick", kind: "monster", attack: 1600, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution cross-player segoc pass handoff opponent response fixture",
      options: { seed: 399, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "500", "700"] },
        1: { main: ["400", "600", "900", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-handoff-opponent-response-starter",
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
            logMessage: "Cross handoff opponent response starter resolved",
          },
          {
            id: "fixture-cross-handoff-opponent-response-turn-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Cross handoff opponent response turn mandatory should not resolve yet",
          },
          {
            id: "fixture-cross-handoff-opponent-response-opponent-mandatory",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Cross handoff opponent response opponent mandatory should not resolve yet",
          },
          {
            id: "fixture-cross-handoff-opponent-response-turn-optional",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Cross handoff opponent response turn optional should not resolve yet",
          },
          {
            id: "fixture-cross-handoff-opponent-response-opponent-optional",
            player: 1,
            code: "600",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Cross handoff opponent response opponent optional should not resolve yet",
          },
          {
            id: "fixture-cross-handoff-opponent-response-turn-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross handoff opponent response turn quick should not resolve yet",
          },
          {
            id: "fixture-cross-handoff-opponent-response-opponent-quick",
            player: 1,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross handoff opponent response opponent quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-handoff-opponent-response-starter" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-handoff-opponent-response-turn-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-handoff-opponent-response-opponent-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-handoff-opponent-response-turn-optional" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-handoff-opponent-response-opponent-optional" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-cross-handoff-opponent-response-opponent-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent trigger player chain-response window restorable before the opponent chains from pass handoff",
            phase: "main1",
            windowId: 6,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
            ],
            chainPasses: [0],
            locations: { graveyard: ["700", "200", "900"], hand: ["100", "300", "500", "400", "600", "800", "800"] },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-opponent-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-cross-handoff-opponent-response-opponent-quick", 1, 6),
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-turn-quick" },
              { type: "activateTrigger", player: 1, windowId: 6, windowKind: "triggerBucket", effectId: "fixture-cross-handoff-opponent-response-opponent-optional", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "fixture-cross-handoff-opponent-response-turn-quick", 6),
              absentTriggerActivationGroup(1, "fixture-cross-handoff-opponent-response-opponent-optional", "opponentOptional", 6, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player responses after the opponent chains from a cross-player chain-created SEGOC pass-handoff window",
            phase: "main1",
            windowId: 7,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
              { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-quick", sourceUid: "p1-deck-900-2" },
            ],
            chainPasses: [],
            locations: { graveyard: ["700", "200", "900"], hand: ["100", "300", "500", "400", "600", "800", "800"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-turn-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-cross-handoff-opponent-response-turn-quick", 1, 7),
              chainPassGroup(0, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-opponent-quick" },
              { type: "activateTrigger", player: 1, windowId: 7, windowKind: "triggerBucket", effectId: "fixture-cross-handoff-opponent-response-opponent-optional", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(1, "fixture-cross-handoff-opponent-response-opponent-quick", 7),
              absentTriggerActivationGroup(1, "fixture-cross-handoff-opponent-response-opponent-optional", "opponentOptional", 7, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps the cross-player chain-created SEGOC chain pending and gives response priority back to the turn player after the opponent chains",
        phase: "main1",
        windowId: 7,
        windowKind: "chainResponse",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-mandatory", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 0, effectId: "fixture-cross-handoff-opponent-response-turn-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-optional", eventName: "sentToGraveyard", eventCardUid: "p0-deck-700-4" },
          { player: 1, effectId: "fixture-cross-handoff-opponent-response-opponent-quick", sourceUid: "p1-deck-900-2" },
        ],
        chainPasses: [],
        locations: { graveyard: ["700", "200", "900"], hand: ["100", "300", "500", "400", "600", "800", "800"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-turn-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "fixture-cross-handoff-opponent-response-turn-quick", 1, 7),
          chainPassGroup(0, 1, 7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-handoff-opponent-response-opponent-quick" },
          { type: "activateTrigger", player: 1, windowId: 7, windowKind: "triggerBucket", effectId: "fixture-cross-handoff-opponent-response-opponent-optional", triggerBucket: "opponentOptional" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(1, "fixture-cross-handoff-opponent-response-opponent-quick", 7),
          absentTriggerActivationGroup(1, "fixture-cross-handoff-opponent-response-opponent-optional", "opponentOptional", 7, "chainResponse"),
        ],
        logIncludes: ["Cross handoff opponent response starter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
