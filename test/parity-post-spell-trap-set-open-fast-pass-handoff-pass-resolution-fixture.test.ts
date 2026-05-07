import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentSpellTrapSetGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity post-Spell/Trap-Set open fast-effect pass handoff pass resolution fixture", () => {
  it("resolves a post-Spell/Trap-Set open fast-effect chain when both players pass after the handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Post Spell Trap Set Pass Resolution Settable Spell", kind: "spell" },
      { code: "300", name: "Post Spell Trap Set Pass Resolution Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Post Spell Trap Set Pass Resolution Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Post Spell Trap Set Pass Resolution Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Post Spell Trap Set Pass Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "post spell trap set open fast pass handoff pass resolution fixture",
      options: { seed: 426, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "600"] },
        1: { main: ["400", "500"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 0, code: "600", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
          { player: 1, code: "500", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "post-spell-trap-set-pass-resolution-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Post Spell/Trap Set pass resolution turn open quick resolved",
          },
          {
            id: "post-spell-trap-set-pass-resolution-turn-chain-quick",
            player: 0,
            code: "600",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Spell/Trap Set pass resolution turn chain quick should not resolve",
          },
          {
            id: "post-spell-trap-set-pass-resolution-opponent-chain-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Post Spell/Trap Set pass resolution opponent chain quick should not resolve",
          },
          {
            id: "post-spell-trap-set-pass-resolution-opponent-open-quick",
            player: 1,
            code: "500",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Post Spell/Trap Set pass resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setSpellTrap", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns Spell/Trap Sets to turn-player open fast-effect priority before post-Spell/Trap-Set handoff chains can begin",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { spellTrapZone: ["100"], graveyard: ["300", "600", "400", "500"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "setSpellTrap", player: 0, windowId: 1, windowKind: "open", uid: "p0-deck-100-0" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSpellTrapSetGroup("p0-deck-100-0", 1),
              absentWindowEffectGroup(0, "post-spell-trap-set-pass-resolution-turn-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "post-spell-trap-set-pass-resolution-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player chain-only responses after the opponent passes a post-Spell/Trap-Set open fast-effect chain",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "post-spell-trap-set-pass-resolution-turn-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            locations: { spellTrapZone: ["100"], graveyard: ["300", "600", "400", "500"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-spell-trap-set-pass-resolution-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "post-spell-trap-set-pass-resolution-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "post-spell-trap-set-pass-resolution-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-spell-trap-set-pass-resolution-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "post-spell-trap-set-pass-resolution-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "post-spell-trap-set-pass-resolution-turn-open-quick", 3),
              absentChainEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-chain-quick", 3),
              absentWindowEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves post-Spell/Trap-Set pass-handoff chains back to turn-player open priority when both players pass after the handoff",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locations: { spellTrapZone: ["100"], graveyard: ["300", "600", "400", "500"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "setSpellTrap", player: 0, windowId: 4, windowKind: "open", uid: "p0-deck-100-0" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "post-spell-trap-set-pass-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSpellTrapSetGroup("p0-deck-100-0", 4),
          absentWindowEffectGroup(0, "post-spell-trap-set-pass-resolution-turn-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "post-spell-trap-set-pass-resolution-turn-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-chain-quick", 4, "open"),
          absentWindowEffectGroup(1, "post-spell-trap-set-pass-resolution-opponent-open-quick", 4, "open"),
        ],
        logIncludes: ["Post Spell/Trap Set pass resolution turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
