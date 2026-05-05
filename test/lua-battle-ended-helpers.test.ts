import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua ended battle helpers", () => {
  it("keeps battle damage helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Ended Damage Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 209, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("damage before " .. Duel.ChangeBattleDamage(1, 500, false))
      Duel.Win(0,WIN_REASON_EXODIA)
      Debug.Message("damage change ended " .. Duel.ChangeBattleDamage(1, 900, false))
      Debug.Message("damage calc ended " .. Duel.CalculateDamage(attacker, target))
      Debug.Message("damage kept " .. Duel.GetBattleDamage(1) .. "/" .. Duel.GetLP(1))
      `,
      "ended-battle-damage-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["damage before 500", "damage change ended 0", "damage calc ended 0", "damage kept 0/8000"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.battleDamage[1]).toBe(0);
    expect(session.state.players[1].lifePoints).toBe(8000);
  });

  it("keeps battle action helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Action Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Ended Action Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Ended Action Replacement", kind: "monster", attack: 1200 },
    ];
    const session = createDuel({ seed: 210, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(replacement).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, replacement!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local replacement = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.ForceAttack(attacker,target)
      Duel.Win(0,WIN_REASON_EXODIA)
      Debug.Message("change target ended " .. tostring(Duel.ChangeAttackTarget(nil)))
      Debug.Message("change attacker ended " .. tostring(Duel.ChangeAttacker(replacement)))
      Debug.Message("chain attack ended " .. tostring(Duel.ChainAttack(target)))
      Debug.Message("force attack ended " .. tostring(Duel.ForceAttack(attacker,target)))
      Debug.Message("negate attack ended " .. tostring(Duel.NegateAttack()))
      Debug.Message("attacker ended " .. tostring(Duel.GetAttacker()==nil) .. "/" .. tostring(Duel.GetAttackTarget()==nil))
      `,
      "ended-battle-actions-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "change target ended false",
      "change attacker ended false",
      "chain attack ended false",
      "force attack ended false",
      "negate attack ended false",
      "attacker ended true/true",
    ]);
    expect(session.state.status).toBe("ended");
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.waitingFor).toBeUndefined();
  });
});
