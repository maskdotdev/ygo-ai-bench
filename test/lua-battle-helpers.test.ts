import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

const preReleaseScript = (code: string): string => fs.readFileSync(`.upstream/ignis/script/pre-release/c${code}.lua`, "utf8");

describe("Lua battle helpers", () => {
  it("lets Lua scripts query whether cards can attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Can Attack", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Defense", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 91, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const defender = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0).position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local defender = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can attack before " .. tostring(attacker:CanAttack()) .. "/" .. tostring(defender:CanAttack()))
      `,
      "can-attack-before.lua",
    );
    expect(before.ok, before.error).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    const during = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local defender = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can attack during " .. tostring(attacker:CanAttack()) .. "/" .. tostring(defender:CanAttack()))
      `,
      "can-attack-during.lua",
    );
    expect(during.ok, during.error).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    const after = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can attack after " .. tostring(attacker:CanAttack()) .. "/" .. attacker:GetAttackAnnouncedCount() .. "/" .. Duel.GetBattledCount(0))
      Debug.Message("can chain attack after " .. tostring(attacker:CanChainAttack()) .. "/" .. tostring(attacker:CanChainAttack(0)))
      `,
      "can-attack-after.lua",
    );

    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toEqual(["can attack before false/false", "can attack during true/false", "can attack after false/1/1", "can chain attack after true/false"]);
  });

  it("lets continuous extra attack effects grant another attack", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Lua Extra Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 92, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_EXTRA_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(1)
        c:RegisterEffect(e)
      end
      `,
      "extra-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(true);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);

    expect(session.state.attacksDeclared.filter((uid) => uid === attacker!.uid)).toHaveLength(2);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
  });

  it("applies Lua defense-attack effects to battle damage", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Defense Attacker", kind: "monster", attack: 500, defense: 2000 }];
    const session = createDuel({ seed: 127, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_DEFENSE_ATTACK)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "defense-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(2000);
    expect(session.state.players[1].lifePoints).toBe(6000);
  });

  it("uses Lua stat updates during battle resolution", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Updated Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Updated Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 131, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const updated = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("attack update battle " .. attacker:UpdateAttack(700, RESETS_STANDARD_PHASE_END) .. "/" .. attacker:GetAttack())
      `,
      "battle-stat-update.lua",
    );
    expect(updated.ok, updated.error).toBe(true);
    expect(host.messages).toContain("attack update battle 700/2500");

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(1500);
    expect(session.state.players[1].lifePoints).toBe(6500);
  });

  it("uses Lua defense updates during defense-position battle resolution", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Small Attacker", kind: "monster", attack: 1200 },
      { code: "200", name: "Updated Defender", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const session = createDuel({ seed: 132, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const updated = host.loadScript(
      `
      local defender=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("defense update battle " .. defender:UpdateDefense(500, RESETS_STANDARD_PHASE_END) .. "/" .. defender:GetDefense())
      `,
      "battle-defense-update.lua",
    );
    expect(updated.ok, updated.error).toBe(true);
    expect(host.messages).toContain("defense update battle 500/1500");

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(300);
    expect(session.state.players[0].lifePoints).toBe(7700);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
  });

  it("applies Lua attack-all monster effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Sweeper", kind: "monster", attack: 1800 },
      { code: "200", name: "First Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Second Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 128, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const firstTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const secondTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ATTACK_ALL)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "attack-all.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === firstTarget!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === secondTarget!.uid)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === secondTarget!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)).toBe(false);
  });

  it("applies Lua extra monster attack effects without granting direct attacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Monster Extra Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "First Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Second Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 129, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const firstTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const secondTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(1)
        c:RegisterEffect(e)
      end
      `,
      "extra-attack-monster.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === firstTarget!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === secondTarget!.uid)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === secondTarget!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)).toBe(false);
  });

  it("loads Black Luster Soldier's battle-destroying trigger from the pre-release script", () => {
    const cards: DuelCardData[] = [
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", attack: 3000 },
      { code: "100", name: "First Target", kind: "monster", attack: 1000 },
      { code: "200", name: "Second Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 106, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["70405001"] },
      1: { main: ["100", "200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "70405001");
    const firstTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "100");
    const secondTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305028"), "c70405001.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === firstTarget!.uid)!);
    passBattleResponses(session);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === attacker!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard", reason: 0x21 });
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
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
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      local self_change=aux.ChangeBattleDamage(0, 700)
      local opponent_change=aux.ChangeBattleDamage(1, 900)
      Debug.Message("aux battle damage self " .. self_change(e, 0) .. "/" .. self_change(e, 1))
      Debug.Message("aux battle damage opponent " .. opponent_change(e, 0) .. "/" .. opponent_change(e, 1))
      `,
      "battle-damage.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("battle damage empty 0");
    expect(host.messages).toContain("battle damage changed 1200");
    expect(host.messages).toContain("battle damage after 1200");
    expect(host.messages).toContain("battle damage floor 0");
    expect(host.messages).toContain("aux battle damage self 700/-1");
    expect(host.messages).toContain("aux battle damage opponent -1/900");
    expect(session.state.battleDamage[1]).toBe(0);
  });

  it("lets Lua scripts check stat change damage step timing", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Stat Timing Probe", kind: "monster" }];
    const session = createDuel({ seed: 159, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `Debug.Message("stat timing main " .. tostring(aux.StatChangeDamageStepCondition()) .. "/" .. Duel.GetCurrentPhase())`,
      "stat-change-main.lua",
    );
    expect(before.ok, before.error).toBe(true);

    session.state.phase = "battle";
    session.state.battleStep = "damage";
    const damageStep = host.loadScript(
      `Debug.Message("stat timing damage " .. tostring(aux.StatChangeDamageStepCondition()) .. "/" .. Duel.GetCurrentPhase() .. "/" .. tostring(Duel.IsDamageCalculated()))`,
      "stat-change-damage.lua",
    );
    expect(damageStep.ok, damageStep.error).toBe(true);

    session.state.battleStep = "damageCalculation";
    const damageCalculation = host.loadScript(
      `Debug.Message("stat timing calculation " .. tostring(aux.StatChangeDamageStepCondition()) .. "/" .. Duel.GetCurrentPhase() .. "/" .. tostring(Duel.IsDamageCalculated()))`,
      "stat-change-damage-calculation.lua",
    );
    expect(damageCalculation.ok, damageCalculation.error).toBe(true);

    expect(host.messages).toEqual([
      "stat timing main true/4",
      "stat timing damage true/32/false",
      "stat timing calculation false/64/true",
    ]);
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
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);

    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(host.messages).toContain("negate window damage 0");
    expect(host.messages).toContain("negate window result true");
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(session.state.pendingBattle).toBeUndefined();
  });

  it("lets Lua scripts use aux battle destruction opponent conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux Battle Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Aux Battle Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 55, startingHandSize: 1, cardReader: createCardReader(cards) });
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

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLE_DESTROYING)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(aux.bdocon)
        e:SetOperation(function(e,tp)
          Debug.Message("aux bdocon attacker resolved")
        end)
        c:RegisterEffect(e)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e2:SetCode(EVENT_BATTLE_DESTROYING)
        e2:SetRange(LOCATION_MZONE)
        e2:SetCondition(aux.bdogcon)
        e2:SetOperation(function(e,tp)
          Debug.Message("aux bdogcon attacker resolved")
        end)
        c:RegisterEffect(e2)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLE_DESTROYING)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(aux.bdocon)
        e:SetOperation(function(e,tp)
          Debug.Message("aux bdocon target should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-aux-bdocon.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateTrigger")).toBe(false);
    applyAndAssert(session, trigger!);
    const secondTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(secondTrigger).toBeDefined();
    applyAndAssert(session, secondTrigger!);
    expect(host.messages).toEqual(["aux bdogcon attacker resolved", "aux bdocon attacker resolved"]);
  });

  it("lets Lua scripts inspect each player's battle monster", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Battle Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Battle Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Lua Battle Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 49, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "200"] },
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
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("battle monster self " .. Duel.GetBattleMonster(0):GetCode())
          Debug.Message("battle monster opponent " .. Duel.GetBattleMonster(1):GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-battle-monster.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

    expect(host.messages).toEqual(["battle monster self 100", "battle monster opponent 200"]);
  });

  it("returns nil for missing Lua battle monsters during direct attacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Direct Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Direct Probe", kind: "monster" },
      { code: "500", name: "Lua Direct Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["500", "500"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("direct battle monster self " .. Duel.GetBattleMonster(0):GetCode())
          Debug.Message("direct battle monster opponent nil " .. tostring(Duel.GetBattleMonster(1) == nil))
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-direct-battle-monster.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

    expect(host.messages).toEqual(["direct battle monster self 100", "direct battle monster opponent nil true"]);
  });

});

function activateEffectByCode(session: ReturnType<typeof createDuel>, player: 0 | 1, code: string) {
  return getDuelLegalActions(session, player).find(
    (candidate) => candidate.type === "activateEffect" && session.state.cards.find((card) => card.uid === candidate.uid)?.code === code,
  );
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}
