import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player later-payload open-fast pass-handoff turn-follow-up opponent-response resolution restore fixture", () => {
  it("resolves back to open priority after the opponent takes the restored follow-up response", () => {
    const firstEventCode = 0x10000047;
    const secondEventCode = 0x10000048;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload Open Fast Follow-Up Resolution Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload Open Fast Follow-Up Resolution Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload Open Fast Follow-Up Resolution Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload Open Fast Follow-Up Resolution Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload Open Fast Follow-Up Resolution Opponent First Chain Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "620", name: "Cross Payload Open Fast Follow-Up Resolution Opponent Second Chain Quick", kind: "monster", attack: 1150, defense: 1150 },
      { code: "700", name: "Cross Payload Open Fast Follow-Up Resolution Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload Open Fast Follow-Up Resolution Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Cross Payload Open Fast Follow-Up Resolution Turn Open Quick", kind: "monster", attack: 1300, defense: 1300 },
      { code: "950", name: "Cross Payload Open Fast Follow-Up Resolution Turn Chain Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "970", name: "Cross Payload Open Fast Follow-Up Resolution Turn Follow-Up Quick", kind: "monster", attack: 1450, defense: 1450 },
      { code: "990", name: "Cross Payload Open Fast Follow-Up Resolution Opponent Open Quick", kind: "monster", attack: 700, defense: 700 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload open-fast pass-handoff turn-follow-up opponent-response resolution restore fixture",
      options: { seed: 403, startingHandSize: 7 },
      decks: {
        0: { main: ["100", "300", "500", "900", "950", "970", "800"] },
        1: { main: ["400", "600", "620", "700", "990", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "500", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: firstEventCode },
              { player: 1, code: "700", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: secondEventCode },
            ],
            logMessage: "Cross payload open-fast follow-up resolution starter resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload open-fast follow-up resolution turn trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-trigger",
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
            logMessage: "Cross payload open-fast follow-up resolution opponent trigger resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-turn-open-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Cross payload open-fast follow-up resolution turn open quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-turn-chain-quick",
            player: 0,
            code: "950",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast follow-up resolution turn chain quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-turn-follow-up-quick",
            player: 0,
            code: "970",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast follow-up resolution turn follow-up quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-first-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast follow-up resolution opponent first chain quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-second-chain-quick",
            player: 1,
            code: "620",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Cross payload open-fast follow-up resolution opponent second chain quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-open-quick",
            player: 1,
            code: "990",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Cross payload open-fast follow-up resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-starter" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-open-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-first-chain-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-follow-up-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-second-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves a restored SEGOC open-fast handoff chain after the opponent takes the final response window",
        phase: "main1",
        windowId: 9,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 11, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-starter", count: 1 },
          { type: "normalSummon", player: 0, windowId: 9, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 9, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 9, windowKind: "open", code: "900", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 9, windowKind: "open", code: "800", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 9, windowKind: "open", code: "800", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 9, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 9, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 9,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-starter", count: 1 }],
          },
          turnGroup(9),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-follow-up-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-open-quick" },
          { type: "activateTrigger", player: 0, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-turn-trigger", triggerBucket: "turnOptional" },
          { type: "activateTrigger", player: 1, windowId: 9, windowKind: "open", effectId: "fixture-cross-payload-open-fast-follow-up-resolution-opponent-trigger", triggerBucket: "opponentOptional" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-follow-up-resolution-turn-open-quick", 9, "open"),
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-follow-up-resolution-turn-chain-quick", 9, "open"),
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-follow-up-resolution-turn-follow-up-quick", 9, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-follow-up-resolution-opponent-first-chain-quick", 9, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-follow-up-resolution-opponent-second-chain-quick", 9, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-follow-up-resolution-opponent-open-quick", 9, "open"),
          absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-follow-up-resolution-turn-trigger", "turnOptional", 9, "open"),
          absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-follow-up-resolution-opponent-trigger", "opponentOptional", 9, "open"),
        ],
        locations: { graveyard: ["500", "700", "600", "620", "950", "970"], hand: ["100", "300", "900", "800", "400", "990", "800"] },
        logIncludes: [
          "Cross payload open-fast follow-up resolution starter resolved",
          "Cross payload open-fast follow-up resolution opponent trigger resolved",
          "Cross payload open-fast follow-up resolution opponent second chain quick resolved",
          "Cross payload open-fast follow-up resolution turn follow-up quick resolved",
          "Cross payload open-fast follow-up resolution opponent first chain quick resolved",
          "Cross payload open-fast follow-up resolution turn chain quick resolved",
          "Cross payload open-fast follow-up resolution turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
