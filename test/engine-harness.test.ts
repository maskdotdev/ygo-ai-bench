import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness diagnostics", () => {
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

  it("reports grouped legal-action fixture expectation failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "grouped legal action expectation fixture",
      options: { seed: 3, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [{ player: 0, label: "Pass", windowKind: "open", count: 1 }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "grouped legal action expectation fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Pass windowKind=open matched 0, expected 1",
      },
    ]);
  });

  it("reports absent grouped legal-action fixture expectation failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "absent grouped legal action expectation fixture",
      options: { seed: 4, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Turn",
            windowKind: "open",
            actions: [{ type: "changePhase", player: 0, phase: "battle" }],
          },
        ],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "absent grouped legal action expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn windowKind=open matched 1",
      },
    ]);
  });

  it("reports action window kind fixture expectation failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "window kind expectation fixture",
      options: { seed: 7, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        windowKind: "chainResponse",
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "window kind expectation fixture",
        message: "before fixture (edopro): Expected windowKind chainResponse, got open",
      },
    ]);
  });

  it("reports legal action count fixture expectation failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "legal action count expectation fixture",
      options: { seed: 8, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionCounts: { 0: 1 },
        legalActionGroupCounts: { 0: 1 },
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "legal action count expectation fixture",
        message: "before fixture (edopro): Expected player 0 legal action count 1, got 4",
      },
      {
        fixture: "legal action count expectation fixture",
        message: "before fixture (edopro): Expected player 0 legal action group count 1, got 2",
      },
    ]);
  });

  it("executes Lua scripts with EDOPro-style globals", () => {
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
    expect(host.getGlobalString("calculation_calculated")).toBe("false");
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
    expect(host.getGlobalString("explicit_damage_calculated")).toBe("false");
    expect(host.getGlobalString("explicit_battle_step")).toBe("false");
  });

});
