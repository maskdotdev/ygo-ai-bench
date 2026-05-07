import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSpellTrapSetGroup, absentWindowEffectGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Spell/Trap Set open fast-effect no-response fixture", () => {
  it("auto-resolves a post-Spell/Trap-Set open fast-effect chain when the opponent has no legal response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Settable No Response Spell", kind: "spell" },
      { code: "300", name: "Turn S/T Set No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent S/T Set No Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "spell trap set open fast no-response fixture",
      options: { seed: 362, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "300", from: "hand", to: "graveyard" },
          { player: 1, code: "400", from: "hand", to: "graveyard" },
        ],
        effects: [
          {
            id: "spell-trap-set-no-response-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn no-response open quick after Spell/Trap Set resolved",
          },
          {
            id: "spell-trap-set-no-response-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent no-response open quick after Spell/Trap Set should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setSpellTrap", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns Spell/Trap Sets to turn-player open priority before post-set fast effects",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-no-response-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-no-response-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "setSpellTrap", player: 0, windowId: 1, windowKind: "open", uid: "p0-deck-100-0" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "spell-trap-set-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSpellTrapSetGroup("p0-deck-100-0", 1),
              absentWindowEffectGroup(1, "spell-trap-set-no-response-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "spell-trap-set-no-response-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the post-Spell/Trap-Set open fast-effect chain immediately when the opponent has no legal response",
            phase: "main1",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(2)],
            absentLegalActions: [
              { type: "setSpellTrap", player: 0, windowId: 2, windowKind: "open", uid: "p0-deck-100-0" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-no-response-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "spell-trap-set-no-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSpellTrapSetGroup("p0-deck-100-0", 2),
              absentWindowEffectGroup(0, "spell-trap-set-no-response-turn-open-quick", 2, "open"),
              absentWindowEffectGroup(1, "spell-trap-set-no-response-opponent-open-quick", 2, "open"),
            ],
            logIncludes: ["Turn no-response open quick after Spell/Trap Set resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to turn-player open priority after a no-response post-Spell/Trap-Set open fast-effect chain",
        phase: "main1",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(2)],
        absentLegalActions: [
          { type: "setSpellTrap", player: 0, windowId: 2, windowKind: "open", uid: "p0-deck-100-0" },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-no-response-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "spell-trap-set-no-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSpellTrapSetGroup("p0-deck-100-0", 2),
          absentWindowEffectGroup(0, "spell-trap-set-no-response-turn-open-quick", 2, "open"),
          absentWindowEffectGroup(1, "spell-trap-set-no-response-opponent-open-quick", 2, "open"),
        ],
        logIncludes: ["Turn no-response open quick after Spell/Trap Set resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
