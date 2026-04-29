import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness scaffolding", () => {
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
});
