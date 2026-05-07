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
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity chain-resolution cross-player later-payload open-fast pass-handoff turn-response pass-resolution restore fixture", () => {
  it("resolves the restored handoff chain back to open priority after the opponent passes", () => {
    const firstEventCode = 0x10000041;
    const secondEventCode = 0x10000042;
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Payload Open Fast Pass Resolution Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Cross Payload Open Fast Pass Resolution Turn Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Cross Payload Open Fast Pass Resolution Opponent Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Cross Payload Open Fast Pass Resolution Turn Body", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Cross Payload Open Fast Pass Resolution Opponent Chain Quick", kind: "monster", attack: 1100, defense: 1100 },
      { code: "700", name: "Cross Payload Open Fast Pass Resolution Opponent Body", kind: "monster", attack: 900, defense: 900 },
      { code: "800", name: "Cross Payload Open Fast Pass Resolution Filler", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Cross Payload Open Fast Pass Resolution Turn Open Quick", kind: "monster", attack: 1300, defense: 1300 },
      { code: "950", name: "Cross Payload Open Fast Pass Resolution Turn Chain Quick", kind: "monster", attack: 1400, defense: 1400 },
      { code: "990", name: "Cross Payload Open Fast Pass Resolution Opponent Open Quick", kind: "monster", attack: 700, defense: 700 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "chain resolution segoc cross-player later-payload open-fast pass-handoff turn-response pass-resolution restore fixture",
      options: { seed: 400, startingHandSize: 7 },
      decks: {
        0: { main: ["100", "300", "500", "900", "950", "800", "800"] },
        1: { main: ["400", "600", "700", "990", "800", "800", "800"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "500", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: firstEventCode },
              { player: 1, code: "700", from: "hand", to: "graveyard", collectEvent: "customEvent", eventCode: secondEventCode },
            ],
            logMessage: "Cross payload open-fast pass-resolution starter resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-turn-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: firstEventCode,
            range: ["hand"],
            logMessage: "Cross payload open-fast pass-resolution turn trigger should not resolve",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger",
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
            logMessage: "Cross payload open-fast pass-resolution opponent trigger resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Cross payload open-fast pass-resolution turn open quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick",
            player: 0,
            code: "950",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload open-fast pass-resolution turn chain quick resolved",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            logMessage: "Cross payload open-fast pass-resolution opponent chain quick should not resolve",
          },
          {
            id: "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick",
            player: 1,
            code: "990",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Cross payload open-fast pass-resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-pass-resolution-starter" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" }), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens opponent response priority after the turn player chains from a restored open-fast handoff",
            windowId: 6,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [
              { player: 0, effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" },
              { player: 0, effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick" },
            ],
            chainPasses: [],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick", 1, 6),
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick" },
              { type: "activateTrigger", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick", 6, "chainResponse"),
              absentChainEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick", 6),
              absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick", 6, "chainResponse"),
              absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", "turnOptional", 6, "chainResponse"),
              absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", "opponentOptional", 6, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the restored final turn pass window before resolving the open-fast handoff chain",
            windowId: 7,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [
              { player: 0, effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" },
              { player: 0, effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick" },
            ],
            chainPasses: [1],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick", 1, 7),
              chainPassGroup(0, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick" },
              { type: "activateTrigger", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", triggerBucket: "turnOptional" },
              { type: "activateTrigger", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", triggerBucket: "opponentOptional" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick", 7, "chainResponse"),
              absentChainEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick", 7),
              absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick", 7, "chainResponse"),
              absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", "turnOptional", 7, "chainResponse"),
              absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", "opponentOptional", 7, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the restored SEGOC open-fast handoff chain after both players pass the reopened response windows",
        phase: "main1",
        windowId: 8,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-starter", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "900", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "800", location: "hand", count: 2 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "800", location: "hand", count: 2 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-starter", count: 1 }],
          },
          turnGroup(8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick" },
          { type: "activateTrigger", player: 0, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", triggerBucket: "turnOptional" },
          { type: "activateTrigger", player: 1, windowId: 8, windowKind: "open", effectId: "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", triggerBucket: "opponentOptional" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-open-quick", 8, "open"),
          absentWindowEffectGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-chain-quick", 8, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-chain-quick", 8, "open"),
          absentWindowEffectGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-open-quick", 8, "open"),
          absentTriggerActivationGroup(0, "fixture-cross-payload-open-fast-pass-resolution-turn-trigger", "turnOptional", 8, "open"),
          absentTriggerActivationGroup(1, "fixture-cross-payload-open-fast-pass-resolution-opponent-trigger", "opponentOptional", 8, "open"),
        ],
        locations: { graveyard: ["500", "700", "600", "950"], hand: ["100", "300", "900", "800", "800", "400", "990", "800", "800"] },
        logIncludes: [
          "Cross payload open-fast pass-resolution starter resolved",
          "Cross payload open-fast pass-resolution opponent trigger resolved",
          "Cross payload open-fast pass-resolution turn chain quick resolved",
          "Cross payload open-fast pass-resolution turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
