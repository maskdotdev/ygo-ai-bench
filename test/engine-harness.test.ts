import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("labels final fixture failures with the expectation source", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "source-labelled final expectation fixture",
      options: { seed: 1, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [],
      expected: {
        source: "parity-backlog",
        note: "tracks missing EDOPro-observed final phase behavior",
        phase: "battle",
      },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "source-labelled final expectation fixture",
        message: "final expected (parity-backlog) [tracks missing EDOPro-observed final phase behavior]: Expected phase battle, got main1",
      },
    ]);
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_turn = Duel.GetTurnCount()
      observed_phase = Duel.GetCurrentPhase()
      observed_turn_player = tostring(Duel.IsTurnPlayer(0))
      observed_not_turn_player = tostring(Duel.IsTurnPlayer(1))
      observed_main_phase = tostring(Duel.IsMainPhase())
      observed_battle_phase = tostring(Duel.IsBattlePhase())
      observed_damage_step = tostring(Duel.IsDamageStep())
      observed_damage_calculated = tostring(Duel.IsDamageCalculated())
      observed_normal_activity = Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON)
      observed_summon_activity = Duel.GetActivityCount(0, ACTIVITY_SUMMON)
      observed_attack_activity = Duel.GetActivityCount(0, ACTIVITY_ATTACK)
      local hand = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      observed_can_summon = tostring(Duel.IsPlayerCanSummon(0, hand))
      observed_can_mset = tostring(Duel.IsPlayerCanMSet(0, hand))
      observed_can_special = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, hand))
      observed_bad_special_position = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEDOWN_ATTACK, 0, hand))
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalNumber("observed_turn")).toBe(1);
    expect(host.getGlobalNumber("observed_phase")).toBe(0x4);
    expect(host.getGlobalString("observed_turn_player")).toBe("true");
    expect(host.getGlobalString("observed_not_turn_player")).toBe("false");
    expect(host.getGlobalString("observed_main_phase")).toBe("true");
    expect(host.getGlobalString("observed_battle_phase")).toBe("false");
    expect(host.getGlobalString("observed_damage_step")).toBe("false");
    expect(host.getGlobalString("observed_damage_calculated")).toBe("false");
    expect(host.getGlobalNumber("observed_normal_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_summon_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_attack_activity")).toBe(0);
    expect(host.getGlobalString("observed_can_summon")).toBe("true");
    expect(host.getGlobalString("observed_can_mset")).toBe("true");
    expect(host.getGlobalString("observed_can_special")).toBe("true");
    expect(host.getGlobalString("observed_bad_special_position")).toBe("false");
    expect(host.messages).toContain("lua host online");
  });

  it("exposes split battle damage timing through Lua phase helpers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    session.state.phase = "battle";

    const host = createLuaScriptHost(session);
    session.state.battleStep = "damage";
    const damageResult = host.loadScript(
      `
      damage_phase = Duel.GetCurrentPhase()
      damage_step = tostring(Duel.IsDamageStep())
      damage_calculated = tostring(Duel.IsDamageCalculated())
      damage_is_phase = tostring(Duel.IsPhase(PHASE_DAMAGE))
      `,
      "damage-step-phase.lua",
    );
    expect(damageResult.ok, damageResult.error).toBe(true);
    expect(host.getGlobalNumber("damage_phase")).toBe(0x20);
    expect(host.getGlobalString("damage_step")).toBe("true");
    expect(host.getGlobalString("damage_calculated")).toBe("false");
    expect(host.getGlobalString("damage_is_phase")).toBe("true");

    session.state.battleStep = "damageCalculation";
    const calculationResult = host.loadScript(
      `
      calculation_phase = Duel.GetCurrentPhase()
      calculation_step = tostring(Duel.IsDamageStep())
      calculation_calculated = tostring(Duel.IsDamageCalculated())
      calculation_is_phase = tostring(Duel.IsPhase(PHASE_DAMAGE_CAL))
      `,
      "damage-calculation-phase.lua",
    );
    expect(calculationResult.ok, calculationResult.error).toBe(true);
    expect(host.getGlobalNumber("calculation_phase")).toBe(0x40);
    expect(host.getGlobalString("calculation_step")).toBe("true");
    expect(host.getGlobalString("calculation_calculated")).toBe("true");
    expect(host.getGlobalString("calculation_is_phase")).toBe("true");
  });

  it("uses explicit battle windows before the legacy battleStep mirror in Lua phase helpers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 5, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    session.state.phase = "battle";
    session.state.battleStep = "attack";
    session.state.battleWindow = {
      id: 0,
      kind: "duringDamageCalculation",
      step: "damageCalculation",
      attackerUid: "p0-deck-100-0",
      responsePlayer: 1,
      attackNegated: false,
    };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      explicit_phase = Duel.GetCurrentPhase()
      explicit_damage_step = tostring(Duel.IsDamageStep())
      explicit_damage_calculated = tostring(Duel.IsDamageCalculated())
      explicit_battle_step = tostring(Duel.IsBattleStep())
      `,
      "explicit-battle-window-phase.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.getGlobalNumber("explicit_phase")).toBe(0x40);
    expect(host.getGlobalString("explicit_damage_step")).toBe("true");
    expect(host.getGlobalString("explicit_damage_calculated")).toBe("true");
    expect(host.getGlobalString("explicit_battle_step")).toBe("false");
  });

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
            },
          }),
        ],
        expected: {
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
            },
          }),
        ],
        expected: {
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
            },
          }),
        ],
        expected: {
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
          absentLegalActions: [{ type: "selectOption", player: 0, promptId: "fixture-option-prompt" }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("selectOption", 1, { promptId: "fixture-option-prompt", option: 4 }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              waitingFor: 0,
              absentLegalActions: [{ type: "selectOption", player: 1, promptId: "fixture-option-prompt" }],
              logIncludes: ["Selected option 4"],
            },
          }),
        ],
        expected: {
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
          absentLegalActions: [{ type: "selectYesNo", player: 1, promptId: "fixture-yes-no-prompt" }],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("selectYesNo", 0, { promptId: "fixture-yes-no-prompt", yes: true }), {
            snapshotRestore: true,
            after: {
              source: "edopro",
              waitingFor: 1,
              absentLegalActions: [{ type: "selectYesNo", player: 0, promptId: "fixture-yes-no-prompt" }],
              logIncludes: ["Selected yes"],
            },
          }),
        ],
        expected: {
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
                },
              ],
              legalActions: [
                { type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
                { type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
              ],
            },
          }),
        ],
        expected: {
          phase: "main1",
          waitingFor: 0,
          pendingTriggers: [
            {
              player: 0,
              effectId: "fixture-normal-summon-trigger",
              eventName: "normalSummoned",
              triggerBucket: "turnOptional",
              eventCardUid: "p0-deck-100-0",
            },
          ],
          chain: [],
          legalActions: [
            { type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
            { type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-normal-summon-trigger", triggerBucket: "turnOptional", count: 1 },
          ],
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
              cards: [{ uid: "p0-deck-100-0", location: "monsterZone", position: "faceUpAttack" }],
            },
            after: {
              source: "edopro",
              positionsChanged: ["p0-deck-100-0"],
              absentLegalActions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone" }],
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
            },
          }),
          makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-allowed-quick" })),
        ],
        expected: {
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
              legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              locations: { monsterZone: ["100"] },
              locationCounts: { hand: { "100": 0 }, monsterZone: { "100": 1 } },
              cards: [{ uid: "p0-deck-100-0", location: "monsterZone", controller: 0, position: "faceUpAttack" }],
              logIncludes: ["Normal Summoned"],
            },
          }),
        ],
        expected: {
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
