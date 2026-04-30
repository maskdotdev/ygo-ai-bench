import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua battle helpers", () => {
  it("lets Lua scripts negate the active attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.currentAttack = { attackerUid: attacker!.uid, targetUid: target!.uid };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("before attacker " .. Duel.GetAttacker():GetCode())
      Debug.Message("before target " .. Duel.GetAttackTarget():GetCode())
      Debug.Message("negate active " .. tostring(Duel.NegateAttack()))
      Debug.Message("after attacker nil " .. tostring(Duel.GetAttacker() == nil))
      Debug.Message("negate empty " .. tostring(Duel.NegateAttack()))
      `,
      "negate-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("before attacker 100");
    expect(host.messages).toContain("before target 200");
    expect(host.messages).toContain("negate active true");
    expect(host.messages).toContain("after attacker nil true");
    expect(host.messages).toContain("negate empty false");
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.log.some((entry) => entry.action === "attack" && entry.detail === "Negated attack")).toBe(true);
  });

  it("lets Lua scripts inspect and change recorded battle damage", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Damage Probe", kind: "monster" }];
    const session = createDuel({ seed: 45, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("battle damage empty " .. Duel.GetBattleDamage(1))
      Debug.Message("battle damage changed " .. Duel.ChangeBattleDamage(1, 1200, false))
      Debug.Message("battle damage after " .. Duel.GetBattleDamage(1))
      Debug.Message("battle damage floor " .. Duel.ChangeBattleDamage(1, -5, false))
      `,
      "battle-damage.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("battle damage empty 0");
    expect(host.messages).toContain("battle damage changed 1200");
    expect(host.messages).toContain("battle damage after 1200");
    expect(host.messages).toContain("battle damage floor 0");
    expect(session.state.battleDamage[1]).toBe(0);
  });

  it("lets attack-announcement triggers negate battle before damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Window Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Window Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Negate Attack Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_ATTACK_ANNOUNCE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("negate window damage " .. Duel.GetBattleDamage(1))
          Debug.Message("negate window result " .. tostring(Duel.NegateAttack()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "negate-attack-window.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid);
    expect(attack).toBeDefined();
    const attackResult = applyResponse(session, attack!);

    expect(attackResult.ok).toBe(true);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(host.messages).toContain("negate window damage 0");
    expect(host.messages).toContain("negate window result true");
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(session.state.pendingBattle).toBeUndefined();
  });
});
