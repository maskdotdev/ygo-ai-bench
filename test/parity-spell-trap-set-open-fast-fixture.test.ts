import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSpellTrapSetGroup, absentWindowEffectGroup, spellTrapSetGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Spell/Trap Set open fast-effect fixture", () => {
  it("returns Spell/Trap Sets to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Settable Spell", kind: "spell" },
      { code: "300", name: "Turn S/T Set Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent S/T Set Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "spell trap set open fast effect fixture",
      options: { seed: 272, startingHandSize: 2 },
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
            id: "spell-trap-set-turn-open-quick",
            player: 0,
            code: "300",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Turn open quick after Spell/Trap Set resolved",
          },
          {
            id: "spell-trap-set-opponent-open-quick",
            player: 1,
            code: "400",
            location: "graveyard",
            event: "quick",
            range: ["graveyard"],
            activationChain: "open",
            logMessage: "Opponent open quick after Spell/Trap Set should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setSpellTrap", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Spell/Trap Set actions beside turn-player open fast effects before the Set is performed",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 },
              { type: "setSpellTrap", player: 0, windowId: 0, windowKind: "open", uid: "p0-deck-100-0", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 }],
              },
              spellTrapSetGroup("p0-deck-100-0", 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "spell-trap-set-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "spell-trap-set-opponent-open-quick", 0, "open")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns Spell/Trap Sets to turn-player open priority with that player's open fast effects available",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "spellTrapZone", position: "faceDown", faceUp: false }],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 }],
              },
              turnGroup(1),
            ],
            absentLegalActions: [
              { type: "setSpellTrap", player: 0, windowId: 1, windowKind: "open", uid: "p0-deck-100-0" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "spell-trap-set-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentSpellTrapSetGroup("p0-deck-100-0", 1),
              absentWindowEffectGroup(1, "spell-trap-set-opponent-open-quick", 1, "open"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open fast-effect priority after a Spell/Trap Set",
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
          { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "spell-trap-set-turn-open-quick", count: 1 }],
          },
          turnGroup(1),
        ],
        absentLegalActions: [
          { type: "setSpellTrap", player: 0, windowId: 1, windowKind: "open", uid: "p0-deck-100-0" },
          { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "spell-trap-set-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentSpellTrapSetGroup("p0-deck-100-0", 1),
          absentWindowEffectGroup(1, "spell-trap-set-opponent-open-quick", 1, "open"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
