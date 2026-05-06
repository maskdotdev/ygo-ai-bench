import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player SEGOC decline pass handoff opponent response fixture", () => {
  it("resolves opponent responses to trigger-player chains from a cross-player post-decline handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Decline Handoff Opponent Response Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Turn Cross Decline Handoff Opponent Response Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "300", name: "Cross Decline Handoff Opponent Response Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Decline Handoff Opponent Response Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Decline Handoff Opponent Response Turn Optional", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Decline Handoff Opponent Response Opponent Optional", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Decline Handoff Opponent Response Moved Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Opponent Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Opponent Cross Decline Handoff Opponent Response Quick", kind: "monster", attack: 1600, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution cross-player segoc decline pass handoff opponent response fixture",
      options: { seed: 323, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "200", "300", "500", "700"] },
        1: { main: ["400", "600", "900", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-decline-handoff-opponent-response-starter",
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
            logMessage: "Cross decline handoff opponent response starter resolved",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-turn-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            optional: false,
            range: ["hand"],
            logMessage: "Cross decline handoff opponent response turn mandatory resolved",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-opponent-mandatory",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            optional: false,
            range: ["hand"],
            logMessage: "Cross decline handoff opponent response opponent mandatory resolved",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-turn-optional",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            range: ["hand"],
            logMessage: "Cross decline handoff opponent response turn optional resolved",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-opponent-optional",
            player: 1,
            code: "600",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            range: ["hand"],
            logMessage: "Cross decline handoff opponent response opponent optional should not resolve",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-turn-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross decline handoff opponent response turn quick resolved",
          },
          {
            id: "fixture-cross-decline-handoff-opponent-response-opponent-quick",
            player: 1,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross decline handoff opponent response opponent quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-decline-handoff-opponent-response-starter" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-decline-handoff-opponent-response-turn-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-decline-handoff-opponent-response-opponent-mandatory" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-decline-handoff-opponent-response-turn-optional" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-cross-decline-handoff-opponent-response-opponent-optional" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-decline-handoff-opponent-response-turn-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-cross-decline-handoff-opponent-response-opponent-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the cross-player post-decline trigger chain after the opponent responds to the trigger player's post-handoff chain link",
        phase: "main1",
        windowId: 8,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 9, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-decline-handoff-opponent-response-starter", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 8, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 8, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 8,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-decline-handoff-opponent-response-starter", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
          ], 1, 8),
          turnGroup(8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-decline-handoff-opponent-response-turn-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "fixture-cross-decline-handoff-opponent-response-opponent-quick" },
          { type: "activateTrigger", player: 1, windowId: 8, windowKind: "open", effectId: "fixture-cross-decline-handoff-opponent-response-opponent-optional" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-cross-decline-handoff-opponent-response-turn-quick", 8, "open"),
          absentWindowEffectGroup(1, "fixture-cross-decline-handoff-opponent-response-opponent-quick", 8, "open"),
          absentTriggerActivationGroup(1, "fixture-cross-decline-handoff-opponent-response-opponent-optional", "opponentOptional", 8, "open"),
        ],
        locations: { graveyard: ["700", "200", "900"], hand: ["100", "300", "500", "400", "600", "800", "800"] },
        logIncludes: [
          "Cross decline handoff opponent response starter resolved",
          "Cross decline handoff opponent response opponent quick resolved",
          "Cross decline handoff opponent response turn quick resolved",
          "Cross decline handoff opponent response turn optional resolved",
          "Cross decline handoff opponent response opponent mandatory resolved",
          "Cross decline handoff opponent response turn mandatory resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
