import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Tribute-Summon pass handoff opponent response turn response chain pass resolution fixture", () => {
  it("resolves post-Tribute-Summon handoff chains after the opponent passes the turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Tribute Handoff Opponent Turn Chain Pass Tribute Summon", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Post Tribute Handoff Opponent Turn Chain Pass Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Post Tribute Handoff Opponent Turn Chain Pass Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Tribute Handoff Opponent Turn Chain Pass Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Tribute Handoff Opponent Turn Chain Pass Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Tribute Handoff Opponent Turn Chain Pass Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Post Tribute Handoff Opponent Turn Chain Pass Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Post Tribute Handoff Opponent Turn Chain Pass Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post tribute summon open fast pass handoff opponent response turn response chain pass resolution fixture",
      options: { seed: 475, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "200", "300", "600"] },
        1: { main: ["400", "500", "800", "900"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
          { player: 1, code: "800", from: "hand", to: "graveyard" },
          { player: 1, code: "900", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass turn open quick resolved",
          },
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass turn chain quick resolved",
          },
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-first-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass opponent first chain quick resolved",
          },
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass opponent second chain quick resolved",
          },
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-third-chain-quick",
            player: 1,
            code: "800",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass opponent third chain quick should not resolve",
          },
          {
            id: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-open-quick",
            player: 1,
            code: "900",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Tribute Summon handoff opponent turn chain pass opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("tributeSummon", 0, { code: "100", location: "hand", tributeUids: ["p0-deck-200-1"] })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves post-Tribute-Summon handoff chains after the opponent passes the response window reopened by the turn player's answer",
        phase: "main1",
        windowId: 7,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { monsterZone: ["100"], graveyard: ["200", "300", "600", "400", "500", "800", "900"] },
        cards: [
          { uid: "p0-deck-100-0", code: "100", location: "monsterZone", position: "faceUpAttack", faceUp: true },
          { uid: "p0-deck-200-1", code: "200", location: "graveyard" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 7, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 7, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(7)],
        absentLegalActions: [
          { type: "tributeSummon", player: 0, windowId: 7, windowKind: "open", code: "100", location: "hand" },
          { type: "tributeSet", player: 0, windowId: 7, windowKind: "open", code: "100", location: "hand" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-third-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSummonGroup({ type: "tributeSummon", player: 0, code: "100", location: "hand" }, 7),
          absentSummonGroup({ type: "tributeSet", player: 0, code: "100", location: "hand" }, 7),
          absentWindowEffectGroup(0, "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-open-quick", 7, "open"),
          absentWindowEffectGroup(0, "post-tribute-summon-handoff-opponent-turn-chain-pass-turn-chain-quick", 7, "open"),
          absentWindowEffectGroup(1, "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-first-chain-quick", 7, "open"),
          absentWindowEffectGroup(1, "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-second-chain-quick", 7, "open"),
          absentWindowEffectGroup(1, "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-third-chain-quick", 7, "open"),
          absentWindowEffectGroup(1, "post-tribute-summon-handoff-opponent-turn-chain-pass-opponent-open-quick", 7, "open"),
        ],
        logIncludes: [
          "Post Tribute Summon handoff opponent turn chain pass turn chain quick resolved",
          "Post Tribute Summon handoff opponent turn chain pass opponent second chain quick resolved",
          "Post Tribute Summon handoff opponent turn chain pass opponent first chain quick resolved",
          "Post Tribute Summon handoff opponent turn chain pass turn open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
