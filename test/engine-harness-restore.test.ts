import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import { absentNormalSummonGroup, normalSummonGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro compatibility harness snapshot restore", () => {
  it("snapshot-restores after scripted fixture responses", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "post-response snapshot fixture",
        options: { seed: 6, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              windowId: 1,
              waitingFor: 0,
              legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              legalActionGroups: [turnGroup(1)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 1,
          turn: 1,
          turnPlayer: 0,
          activityCounts: { 0: { summon: 1, normalSummon: 1 }, 1: { summon: 0, normalSummon: 0 } },
          activityHistory: [
            { player: 0, activity: 2, cardUid: "p0-deck-100-0" },
            { player: 0, activity: 1, cardUid: "p0-deck-100-0" },
          ],
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores after scripted responses that open battle windows", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 1800, def: 1200 },
        { id: 200, type: 1, atk: 1000, def: 1000 },
      ],
      [],
    );
    const result = runScriptedDuelFixture(
      {
        name: "post-response battle window snapshot fixture",
        options: { seed: 7, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
          makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 1,
              battleStep: "attack",
              battleWindow: {
                kind: "attackNegationResponse",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 1,
              },
              pendingBattle: true,
              currentAttack: true,
              attackPasses: [],
              damagePasses: [],
              attacksDeclared: ["p0-deck-100-0"],
              attackCanceledUids: [],
              attackedTargetUids: [],
              battlePairs: [],
              legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
              legalActionGroups: [passBattleGroup(1, "passAttack", 1)],
            },
          }),
          makeScriptedStep(makeResponseSelector("passAttack", 1), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 0,
              battleStep: "attack",
              battleWindow: {
                kind: "attackNegationResponse",
                step: "attack",
                attackerUid: "p0-deck-100-0",
                responsePlayer: 0,
              },
              pendingBattle: true,
              currentAttack: true,
              attackPasses: [1],
              damagePasses: [],
              legalActions: [{ type: "passAttack", player: 0, windowKind: "battle", count: 1 }],
              legalActionGroups: [passBattleGroup(0, "passAttack", 1)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          phase: "battle",
          waitingFor: 0,
          pendingBattle: true,
          currentAttack: true,
          battleWindow: {
            kind: "attackNegationResponse",
            step: "attack",
            attackerUid: "p0-deck-100-0",
            responsePlayer: 0,
          },
          legalActions: [{ type: "passAttack", player: 0, windowKind: "battle", count: 1 }],
          legalActionGroups: [passBattleGroup(0, "passAttack", 1)],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores after scripted responses that open chain windows", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "post-response chain window snapshot fixture",
        options: { seed: 8, startingHandSize: 3 },
        decks: {
          0: { main: ["100", "200", "300"] },
          1: { main: ["400", "100", "100"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-normal-summon-trigger",
              player: 0,
              code: "200",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              triggerTiming: "if",
              range: ["hand"],
              oncePerTurn: true,
              logMessage: "Fixture trigger resolved",
            },
            {
              id: "fixture-chain-quick",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture quick resolved",
            },
            {
              id: "fixture-opponent-chain-quick",
              player: 1,
              code: "400",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture opponent quick resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
          makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-normal-summon-trigger" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 1,
              chainPasses: [],
              usedCountKeys: ["turn-1:0:p0-deck-200-1:fixture-normal-summon-trigger"],
              chain: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
              pendingTriggers: [],
              legalActions: [
                { type: "activateEffect", player: 1, windowKind: "chainResponse", effectId: "fixture-opponent-chain-quick", count: 1 },
                { type: "passChain", player: 1, windowKind: "chainResponse", count: 1 },
              ],
              legalActionGroups: [
                { player: 1, label: "Effects", windowKind: "chainResponse", actions: [{ type: "activateEffect", player: 1, effectId: "fixture-opponent-chain-quick", count: 1 }] },
                { player: 1, label: "Pass", windowKind: "chainResponse", actions: [{ type: "passChain", player: 1, count: 1 }] },
              ],
            },
          }),
          makeScriptedStep(makeResponseSelector("passChain", 1), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 0,
              chainPasses: [1],
              chain: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
              legalActions: [
                { type: "activateEffect", player: 0, windowKind: "chainResponse", effectId: "fixture-chain-quick", count: 1 },
                { type: "passChain", player: 0, windowKind: "chainResponse", count: 1 },
              ],
              legalActionGroups: [
                { player: 0, label: "Effects", windowKind: "chainResponse", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-chain-quick", count: 1 }] },
                { player: 0, label: "Pass", windowKind: "chainResponse", actions: [{ type: "passChain", player: 0, count: 1 }] },
              ],
            },
          }),
        ],
        expected: {
          source: "edopro",
          phase: "main1",
          waitingFor: 0,
          chainPasses: [1],
          usedCountKeys: ["turn-1:0:p0-deck-200-1:fixture-normal-summon-trigger"],
          chain: [{ player: 0, effectId: "fixture-normal-summon-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
          pendingTriggers: [],
          legalActions: [
            { type: "activateEffect", player: 0, windowKind: "chainResponse", effectId: "fixture-chain-quick", count: 1 },
            { type: "passChain", player: 0, windowKind: "chainResponse", count: 1 },
          ],
          legalActionGroups: [
            { player: 0, label: "Effects", windowKind: "chainResponse", actions: [{ type: "activateEffect", player: 0, effectId: "fixture-chain-quick", count: 1 }] },
            { player: 0, label: "Pass", windowKind: "chainResponse", actions: [{ type: "passChain", player: 0, count: 1 }] },
          ],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("runs scripted prompt-window fixtures with snapshot restore", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "prompt window snapshot fixture",
        options: { seed: 9, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          prompt: { id: "fixture-option-prompt", type: "selectOption", player: 1, options: [2, 4], returnTo: 0 },
        },
        before: {
          source: "edopro",
          waitingFor: 1,
          prompt: { id: "fixture-option-prompt", type: "selectOption", player: 1 },
          legalActions: [
            { type: "selectOption", player: 1, promptId: "fixture-option-prompt", option: 2, windowKind: "prompt", count: 1 },
            { type: "selectOption", player: 1, promptId: "fixture-option-prompt", option: 4, windowKind: "prompt", count: 1 },
          ],
          legalActionGroups: [
            {
              player: 1,
              label: "Option Prompt",
              windowKind: "prompt",
              actions: [
                { type: "selectOption", player: 1, promptId: "fixture-option-prompt", option: 2, count: 1 },
                { type: "selectOption", player: 1, promptId: "fixture-option-prompt", option: 4, count: 1 },
              ],
            },
          ],
          absentLegalActions: [{ type: "selectOption", player: 0, promptId: "fixture-option-prompt" }],
          absentLegalActionGroups: [
            { player: 0, label: "Option Prompt", windowKind: "prompt", actions: [{ type: "selectOption", player: 0, promptId: "fixture-option-prompt" }] },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("selectOption", 1, { promptId: "fixture-option-prompt", option: 4 }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              waitingFor: 0,
              absentLegalActions: [{ type: "selectOption", player: 1, promptId: "fixture-option-prompt" }],
              absentLegalActionGroups: [
                { player: 1, label: "Option Prompt", windowKind: "prompt", actions: [{ type: "selectOption", player: 1, promptId: "fixture-option-prompt" }] },
              ],
              logIncludes: ["Selected option 4"],
            },
          }),
        ],
        expected: {
          source: "edopro",
          waitingFor: 0,
          prompt: null,
          logIncludes: ["Selected option 4"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("runs scripted yes-no prompt-window fixtures with snapshot restore", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "yes-no prompt window snapshot fixture",
        options: { seed: 10, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          prompt: { id: "fixture-yes-no-prompt", type: "selectYesNo", player: 0, description: 700, returnTo: 1 },
        },
        before: {
          source: "edopro",
          waitingFor: 0,
          prompt: { id: "fixture-yes-no-prompt", type: "selectYesNo", player: 0, description: 700 },
          legalActions: [
            { type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt", yes: true, windowKind: "prompt", count: 1 },
            { type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt", yes: false, windowKind: "prompt", count: 1 },
          ],
          legalActionGroups: [
            {
              player: 0,
              label: "Yes / No Prompt",
              windowKind: "prompt",
              actions: [
                { type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt", yes: true, count: 1 },
                { type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt", yes: false, count: 1 },
              ],
            },
          ],
          absentLegalActions: [{ type: "selectYesNo", player: 1, promptId: "fixture-yes-no-prompt" }],
          absentLegalActionGroups: [
            { player: 1, label: "Yes / No Prompt", windowKind: "prompt", actions: [{ type: "selectYesNo", player: 1, promptId: "fixture-yes-no-prompt" }] },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("selectYesNo", 0, { promptId: "fixture-yes-no-prompt", yes: true }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              waitingFor: 1,
              absentLegalActions: [{ type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt" }],
              absentLegalActionGroups: [
                { player: 0, label: "Yes / No Prompt", windowKind: "prompt", actions: [{ type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt" }] },
              ],
              logIncludes: ["Selected yes"],
            },
          }),
        ],
        expected: {
          source: "edopro",
          waitingFor: 1,
          prompt: null,
          logIncludes: ["Selected yes"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores after scripted responses that open trigger-bucket windows", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "post-response trigger-bucket snapshot fixture",
        options: { seed: 11, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["100", "100"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-normal-summon-trigger",
              player: 0,
              code: "200",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              triggerTiming: "if",
              range: ["hand"],
              logMessage: "Fixture trigger resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 0,
              pendingTriggers: [
                {
                  player: 0,
                  effectId: "fixture-normal-summon-trigger",
                  eventName: "normalSummoned",
                  triggerBucket: "turnOptional",
                  eventCardUid: "p0-deck-100-0",
                  eventTriggerTiming: "if",
                },
              ],
              legalActions: [
                { type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
                { type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
              ],
              legalActionGroups: [
                { player: 0, label: "Trigger Activations", windowKind: "triggerBucket", actions: [{ type: "activateTrigger", player: 0, effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 }] },
                { player: 0, label: "Trigger Declines", windowKind: "triggerBucket", actions: [{ type: "declineTrigger", player: 0, effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 }] },
              ],
            },
          }),
        ],
        expected: {
          source: "edopro",
          phase: "main1",
          waitingFor: 0,
          pendingTriggers: [
            {
              player: 0,
              effectId: "fixture-normal-summon-trigger",
              eventName: "normalSummoned",
              triggerBucket: "turnOptional",
              eventCardUid: "p0-deck-100-0",
              eventTriggerTiming: "if",
            },
          ],
          chain: [],
          legalActions: [
            { type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
            { type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
          ],
          legalActionGroups: [
            { player: 0, label: "Trigger Activations", windowKind: "triggerBucket", actions: [{ type: "activateTrigger", player: 0, effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 }] },
            { player: 0, label: "Trigger Declines", windowKind: "triggerBucket", actions: [{ type: "declineTrigger", player: 0, effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 }] },
          ],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores scripted same-bucket trigger ordering prompts", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "trigger order prompt snapshot fixture",
        options: { seed: 15, startingHandSize: 3 },
        decks: {
          0: { main: ["100", "200", "300"] },
          1: { main: ["100", "100", "100"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-first-trigger",
              player: 0,
              code: "200",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              triggerTiming: "if",
              range: ["hand"],
              logMessage: "Fixture first trigger resolved",
            },
            {
              id: "fixture-second-trigger",
              player: 0,
              code: "300",
              location: "hand",
              event: "trigger",
              triggerEvent: "normalSummoned",
              triggerTiming: "if",
              range: ["hand"],
              logMessage: "Fixture second trigger resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              windowId: 1,
              windowKind: "triggerBucket",
              waitingFor: 0,
              triggerOrderPrompt: {
                id: "1:turnOptional:0",
                type: "orderTriggers",
                player: 0,
                triggerBucket: "turnOptional",
              },
              pendingTriggers: [
                { id: "trigger-9-1", player: 0, effectId: "fixture-first-trigger", triggerBucket: "turnOptional" },
                { id: "trigger-9-2", player: 0, effectId: "fixture-second-trigger", triggerBucket: "turnOptional" },
              ],
              pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional", triggerIds: ["trigger-9-1", "trigger-9-2"] }],
              legalActionCounts: { 0: 4, 1: 0 },
              legalActionGroupCounts: { 0: 2, 1: 0 },
              legalActions: [
                { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-trigger", triggerBucket: "turnOptional", count: 1 },
                { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-trigger", triggerBucket: "turnOptional", count: 1 },
              ],
              legalActionGroups: [
                { player: 0, label: "Trigger Activations", windowId: 1, windowKind: "triggerBucket", actions: [{ type: "activateTrigger", player: 0, triggerBucket: "turnOptional", count: 2 }] },
                { player: 0, label: "Trigger Declines", windowId: 1, windowKind: "triggerBucket", actions: [{ type: "declineTrigger", player: 0, triggerBucket: "turnOptional", count: 2 }] },
              ],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-first-trigger" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              windowId: 2,
              windowKind: "triggerBucket",
              waitingFor: 0,
              triggerOrderPrompt: null,
              pendingTriggers: [{ id: "trigger-9-2", player: 0, effectId: "fixture-second-trigger", triggerBucket: "turnOptional" }],
              pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional", triggerIds: ["trigger-9-2"] }],
              chain: [{ player: 0, effectId: "fixture-first-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
              legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-second-trigger", triggerBucket: "turnOptional", count: 1 }],
            },
          }),
        ],
        expected: {
          source: "edopro",
          windowId: 2,
          windowKind: "triggerBucket",
          waitingFor: 0,
          triggerOrderPrompt: null,
          pendingTriggers: [{ id: "trigger-9-2", player: 0, effectId: "fixture-second-trigger", triggerBucket: "turnOptional" }],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores scripted position-change markers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "position marker snapshot fixture",
        options: { seed: 13, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("changePosition", 0, { code: "100", location: "monsterZone", position: "faceUpDefense" }), {
            snapshotRestore: "both",
            before: {
              source: "edopro",
              positionsChanged: [],
              legalActions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", count: 1 }],
              legalActionGroups: [
                { player: 0, label: "Actions", windowKind: "open", actions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", count: 1 }] },
              ],
              cards: [{ uid: "p0-deck-100-0", location: "monsterZone", position: "faceUpAttack" }],
            },
            after: {
              source: "edopro",
              positionsChanged: ["p0-deck-100-0"],
              absentLegalActions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone" }],
              absentLegalActionGroups: [
                { player: 0, label: "Actions", windowKind: "open", actions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone" }] },
              ],
              cards: [{ uid: "p0-deck-100-0", location: "monsterZone", position: "faceUpDefense" }],
              log: [
                { action: "draw", player: 0, card: "Card 100" },
                { action: "draw", player: 1, card: "Card 200" },
                { action: "startDuel" },
                { action: "changePosition", player: 0, card: "Card 100", detail: "faceUpDefense" },
              ],
            },
          }),
        ],
        expected: {
          source: "edopro",
          positionsChanged: ["p0-deck-100-0"],
          cards: [{ uid: "p0-deck-100-0", location: "monsterZone", position: "faceUpDefense" }],
          log: [
            { action: "draw", player: 0, card: "Card 100" },
            { action: "draw", player: 1, card: "Card 200" },
            { action: "startDuel" },
            { action: "changePosition", player: 0, card: "Card 100", detail: "faceUpDefense" },
          ],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores scripted chain-limit windows", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "chain limit snapshot fixture",
        options: { seed: 14, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["200", "400"] },
        },
        setup: {
          effects: [
            {
              id: "fixture-limit-source",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 1 },
              logMessage: "Fixture limit source resolved",
            },
            {
              id: "fixture-allowed-quick",
              player: 1,
              code: "200",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture allowed quick resolved",
            },
            {
              id: "fixture-blocked-chainback",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              logMessage: "Fixture blocked chainback resolved",
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-limit-source" }), {
            snapshotRestore: "after",
            after: {
              source: "edopro",
              waitingFor: 1,
              chainLimits: [{ registryKey: "fixture-chain-limit:chain limit snapshot fixture:fixture-limit-source:p0-deck-100-0", untilChainEnd: true }],
              chain: [{ player: 0, effectId: "fixture-limit-source" }],
              legalActions: [{ type: "activateEffect", player: 1, effectId: "fixture-allowed-quick", windowKind: "chainResponse", count: 1 }],
              legalActionGroups: [
                { player: 1, label: "Effects", windowKind: "chainResponse", actions: [{ type: "activateEffect", player: 1, effectId: "fixture-allowed-quick", count: 1 }] },
              ],
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-allowed-quick" })),
          makeScriptedStep(makeResponseSelector("passChain", 1)),
        ],
        expected: {
          source: "edopro",
          waitingFor: 0,
          chainLimits: [],
          chain: [],
          logIncludes: ["Fixture allowed quick resolved", "Fixture limit source resolved"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("snapshot-restores both sides of scripted fixture responses", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "both-side snapshot fixture",
        options: { seed: 12, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [
          makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
            snapshotRestore: "both",
            before: {
              source: "edopro",
              status: "awaiting",
              winner: null,
              winReason: null,
              waitingFor: 0,
              turn: 1,
              turnPlayer: 0,
              randomCounter: 0,
              lastDiceResults: [],
              lastCoinResults: [],
              lifePoints: { 0: 8000, 1: 8000 },
              activityCounts: { 0: { summon: 0, normalSummon: 0 }, 1: { summon: 0, normalSummon: 0 } },
              activityHistory: [],
              skippedPhases: [],
              phaseActivity: false,
              battleDamage: { 0: 0, 1: 0 },
              attackCostPaid: 0,
              options: { startingLifePoints: 8000, startingHandSize: 1, drawPerTurn: 1 },
              duelTypeFlags: 188416,
              globalFlags: 0,
              unofficialProcEnabled: false,
              shuffleCheckDisabled: false,
              chainLimits: [],
              legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", count: 1 }],
              legalActionGroups: [normalSummonGroup(0, "100", "hand")],
              locations: { hand: ["100"] },
              locationCounts: { monsterZone: { "100": 0 } },
              cards: [{ uid: "p0-deck-100-0", location: "hand", controller: 0 }],
            },
            after: {
              source: "edopro",
              status: "awaiting",
              winner: null,
              winReason: null,
              windowId: 1,
              waitingFor: 0,
              turn: 1,
              turnPlayer: 0,
              randomCounter: 0,
              lastDiceResults: [],
              lastCoinResults: [],
              lifePoints: { 0: 8000, 1: 8000 },
              activityCounts: { 0: { summon: 1, normalSummon: 1 }, 1: { summon: 0, normalSummon: 0 } },
              activityHistory: [
                { player: 0, activity: 2, cardUid: "p0-deck-100-0" },
                { player: 0, activity: 1, cardUid: "p0-deck-100-0" },
              ],
              skippedPhases: [],
              phaseActivity: true,
              battleDamage: { 0: 0, 1: 0 },
              attackCostPaid: 0,
              options: { startingLifePoints: 8000, startingHandSize: 1, drawPerTurn: 1 },
              duelTypeFlags: 188416,
              globalFlags: 0,
              unofficialProcEnabled: false,
              shuffleCheckDisabled: false,
              chainLimits: [],
              absentLegalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand" }],
              absentLegalActionGroups: [absentNormalSummonGroup(0, "100", "hand")],
              legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              legalActionGroups: [turnGroup(1)],
              locations: { monsterZone: ["100"] },
              locationCounts: { hand: { "100": 0 }, monsterZone: { "100": 1 } },
              cards: [{ uid: "p0-deck-100-0", location: "monsterZone", controller: 0, position: "faceUpAttack" }],
              logIncludes: ["Normal Summoned"],
            },
          }),
        ],
        expected: {
          source: "edopro",
          status: "awaiting",
          winner: null,
          winReason: null,
          windowId: 1,
          turn: 1,
          turnPlayer: 0,
          randomCounter: 0,
          lastDiceResults: [],
          lastCoinResults: [],
          skippedPhases: [],
          phaseActivity: true,
          battleDamage: { 0: 0, 1: 0 },
          attackCostPaid: 0,
          options: { startingLifePoints: 8000, startingHandSize: 1, drawPerTurn: 1 },
          duelTypeFlags: 188416,
          globalFlags: 0,
          unofficialProcEnabled: false,
          shuffleCheckDisabled: false,
          chainLimits: [],
          activityCounts: { 0: { summon: 1, normalSummon: 1 }, 1: { summon: 0, normalSummon: 0 } },
          activityHistory: [
            { player: 0, activity: 2, cardUid: "p0-deck-100-0" },
            { player: 0, activity: 1, cardUid: "p0-deck-100-0" },
          ],
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });
});
