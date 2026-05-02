import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    const during = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local defender = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can attack during " .. tostring(attacker:CanAttack()) .. "/" .. tostring(defender:CanAttack()))
      `,
      "can-attack-during.lua",
    );
    expect(during.ok, during.error).toBe(true);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    const after = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can attack after " .. tostring(attacker:CanAttack()) .. "/" .. attacker:GetAttackAnnouncedCount() .. "/" .. Duel.GetBattledCount(0))
      `,
      "can-attack-after.lua",
    );

    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toEqual(["can attack before false/false", "can attack during true/false", "can attack after false/1/1"]);
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(2000);
    expect(session.state.players[1].lifePoints).toBe(6000);
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === firstTarget!.uid)!).ok).toBe(true);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === secondTarget!.uid)).toBe(true);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === secondTarget!.uid)!).ok).toBe(true);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)).toBe(false);
  });

  it("loads Black Luster Soldier and grants another attack after battle destruction", () => {
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
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c70405001.lua", "utf8"), "c70405001.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === firstTarget!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === attacker!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard", reason: 0x21 });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === secondTarget!.uid)).toBe(true);
  });

  it("applies player-scoped Lua battle damage prevention effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Prevented Damage Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 93, startingHandSize: 1, cardReader: createCardReader(cards) });
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
      local e=Effect.GlobalEffect()
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)
      e:SetTargetRange(0,1)
      Duel.RegisterEffect(e,0)
      `,
      "avoid-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(0);
    expect(session.state.players[1].lifePoints).toBe(8000);
  });

  it("applies Lua no-battle-damage effects from battling cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "No Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "No Damage Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 110, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_NO_BATTLE_DAMAGE)
        e:SetCondition(function(e) return Duel.GetAttacker()==e:GetHandler() end)
        c:RegisterEffect(e)
      end
      `,
      "no-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(0);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("applies Lua avoid-battle-damage effects from battling cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Avoid Damage Attacker", kind: "monster", attack: 1000 },
      { code: "200", name: "Avoid Damage Target", kind: "monster", defense: 1800 },
    ];
    const session = createDuel({ seed: 111, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)
        e:SetCondition(function(e) return Duel.GetAttacker()==e:GetHandler() end)
        c:RegisterEffect(e)
      end
      `,
      "avoid-battle-damage-single.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(0);
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies Lua battle damage change callbacks from battling cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Double Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Double Damage Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 112, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)
        e:SetValue(aux.ChangeBattleDamage(1,DOUBLE_DAMAGE))
        c:RegisterEffect(e)
      end
      `,
      "change-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 208)).toMatchObject({ sourceUid: attacker!.uid, range: ["monsterZone"] });
    expect(host.getGlobalNumber("DOUBLE_DAMAGE")).toBe(0x80000000);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(1600);
    expect(session.state.players[1].lifePoints).toBe(6400);
  });

  it("applies Lua battle damage reflection effects from battling cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reflect Damage Attacker", kind: "monster", attack: 1000 },
      { code: "200", name: "Reflect Damage Target", kind: "monster", defense: 1800 },
    ];
    const session = createDuel({ seed: 113, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)
        e:SetCondition(function(e) return Duel.GetAttacker()==e:GetHandler() end)
        c:RegisterEffect(e)
      end
      `,
      "reflect-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(0);
    expect(session.state.battleDamage[1]).toBe(800);
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(7200);
  });

  it("applies player-scoped Lua battle damage reflection effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Reflect Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Field Reflect Source", kind: "spell" },
    ];
    const session = createDuel({ seed: 114, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(source).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)
        e:SetRange(LOCATION_SZONE)
        e:SetTargetRange(0,1)
        c:RegisterEffect(e)
      end
      `,
      "reflect-battle-damage-player.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(1800);
    expect(session.state.battleDamage[1]).toBe(0);
    expect(session.state.players[0].lifePoints).toBe(6200);
    expect(session.state.players[1].lifePoints).toBe(8000);
  });

  it("applies Lua piercing battle damage effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Piercing Attacker", kind: "monster", attack: 2200 },
      { code: "200", name: "Piercing Target", kind: "monster", defense: 1500 },
    ];
    const session = createDuel({ seed: 115, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_PIERCE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "piercing-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(700);
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("applies Lua both-player battle damage effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Shared Damage Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 116, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_BOTH_BATTLE_DAMAGE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "both-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(1800);
    expect(session.state.battleDamage[1]).toBe(1800);
    expect(session.state.players[0].lifePoints).toBe(6200);
    expect(session.state.players[1].lifePoints).toBe(6200);
  });

  it("applies Lua also-battle-damage effects when the source controller takes damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Also Damage Attacker", kind: "monster", attack: 1000 },
      { code: "200", name: "Also Damage Target", kind: "monster", defense: 1800 },
    ];
    const session = createDuel({ seed: 117, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ALSO_BATTLE_DAMAGE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "also-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[0]).toBe(800);
    expect(session.state.battleDamage[1]).toBe(800);
    expect(session.state.players[0].lifePoints).toBe(7200);
    expect(session.state.players[1].lifePoints).toBe(7200);
  });

  it("converts Lua battle damage to effect damage", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Effect Damage Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 118, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_BATTLE_DAMAGE_TO_EFFECT)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "battle-damage-to-effect.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(1800);
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.log.some((entry) => entry.action === "effectDamage" && entry.player === 1 && entry.detail === "1800")).toBe(true);
    expect(session.state.log.some((entry) => entry.action === "damage" && entry.player === 1 && entry.detail === "1800")).toBe(false);
  });

  it("applies Lua battle destroy redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Redirect Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Redirect Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 119, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
        e:SetValue(LOCATION_REMOVED)
        c:RegisterEffect(e)
      end
      `,
      "battle-destroy-redirect.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(session.state.log.some((entry) => entry.action === "destroy" && entry.card === "Redirect Target" && entry.detail === "Destroyed and moved to banished")).toBe(true);
  });

  it("applies Lua field-scoped battle destroy redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Redirect Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Field Redirect Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Field Redirect Source", kind: "monster", attack: 500 },
    ];
    const session = createDuel({ seed: 120, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(LOCATION_MZONE,0)
        e:SetTarget(function(e,c) return c:IsCode(100) end)
        e:SetValue(LOCATION_REMOVED)
        c:RegisterEffect(e)
      end
      `,
      "field-battle-destroy-redirect.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies Lua cannot-direct-attack effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "No Direct Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 121, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "cannot-direct-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
  });

  it("applies Lua cannot-attack-announce effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Announcement Locked Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 122, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "cannot-attack-announce.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
  });

  it("applies Lua must-attack-monster target predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Magnetic Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Allowed Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Blocked Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const allowedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const blockedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(allowedTarget).toBeDefined();
    expect(blockedTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, allowedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, blockedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_MUST_ATTACK_MONSTER)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "must-attack-monster.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === allowedTarget!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === blockedTarget!.uid)).toBe(false);
  });

  it("applies Lua only-be-attacked target restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Guarded Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Open Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 124, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const guardedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const openTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(guardedTarget).toBeDefined();
    expect(openTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, guardedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, openTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ONLY_BE_ATTACKED)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "only-be-attacked.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === guardedTarget!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === openTarget!.uid)).toBe(false);
  });

  it("applies Lua first-attack restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Later Attacker", kind: "monster", attack: 1600 },
    ];
    const session = createDuel({ seed: 125, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const firstAttacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const laterAttacker = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    expect(firstAttacker).toBeDefined();
    expect(laterAttacker).toBeDefined();
    moveDuelCard(session.state, firstAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, laterAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_FIRST_ATTACK)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "first-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === firstAttacker!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === laterAttacker!.uid)).toBe(false);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === firstAttacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === laterAttacker!.uid)).toBe(true);
  });

  it("applies Lua must-attack phase restrictions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Compulsory Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 126, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_MUST_ATTACK)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "must-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePhase")).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "endTurn")).toBe(false);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePhase")).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "endTurn")).toBe(true);
  });

  it("passes the battle opponent to Lua indestructible battle value callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Indestructible Check Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Indestructible Check Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(aux.indoval)
        c:RegisterEffect(e)
      end
      `,
      "battle-indestructible-value.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.battleDamage[1]).toBe(800);
    expect(session.state.players[1].lifePoints).toBe(7200);
  });

  it("applies Lua cannot-be-battle-target continuous effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Lock Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Protected Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Legal Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 108, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const protectedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const legalTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(protectedTarget).toBeDefined();
    expect(legalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, protectedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, legalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "cannot-be-battle-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === protectedTarget!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === legalTarget!.uid)).toBe(true);
  });

  it("applies Lua cannot-select-battle-target value callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Selection Lock Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Selection Lock Source", kind: "monster", attack: 1000 },
      { code: "300", name: "Selection Locked Target", kind: "monster", attack: 1000 },
      { code: "400", name: "Selection Legal Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 109, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300", "400"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const source = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const blockedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    const legalTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "400");
    expect(attacker).toBeDefined();
    expect(source).toBeDefined();
    expect(blockedTarget).toBeDefined();
    expect(legalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, source!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, blockedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, legalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(0,LOCATION_MZONE)
        e:SetValue(function(e,c) return c:IsCode(300) end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-select-battle-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === blockedTarget!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === source!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === legalTarget!.uid)).toBe(true);
  });

  it("lets Lua scripts calculate battle damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Attack Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Defense Attacker", kind: "monster", attack: 1500 },
      { code: "400", name: "Defense Target", kind: "monster", defense: 2000 },
    ];
    const session = createDuel({ seed: 76, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "400"] },
    });
    startDuel(session);

    const attackAttacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const attackTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const defenseAttacker = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const defenseTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "400");
    expect(attackAttacker).toBeDefined();
    expect(attackTarget).toBeDefined();
    expect(defenseAttacker).toBeDefined();
    expect(defenseTarget).toBeDefined();
    moveDuelCard(session.state, attackAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attackTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, defenseAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defenseTarget!.uid, "monsterZone", 1).position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local atk_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local atk_t = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local def_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local def_t = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("calc attack " .. Duel.CalculateDamage(atk_a, atk_t))
      Debug.Message("calc attack damage " .. Duel.GetBattleDamage(1) .. "/" .. Duel.GetLP(1))
      Debug.Message("calc defense " .. Duel.CalculateDamage(def_a, def_t))
      Debug.Message("calc defense damage " .. Duel.GetBattleDamage(0) .. "/" .. Duel.GetLP(0))
      Debug.Message("calc override " .. Duel.CalculateDamage(atk_a, atk_t, 900, 1200))
      Debug.Message("calc override damage " .. Duel.GetBattleDamage(0) .. "/" .. Duel.GetLP(0))
      `,
      "calculate-damage.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("calc attack 800");
    expect(host.messages).toContain("calc attack damage 800/7200");
    expect(host.messages).toContain("calc defense 500");
    expect(host.messages).toContain("calc defense damage 500/7500");
    expect(host.messages).toContain("calc override 300");
    expect(host.messages).toContain("calc override damage 300/7200");
    expect(session.state.players[0].lifePoints).toBe(7200);
    expect(session.state.players[1].lifePoints).toBe(7200);
  });

  it("lets Lua scripts force an attack between monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Forced Attacker", kind: "monster", attack: 2200 },
      { code: "200", name: "Forced Target", kind: "monster", attack: 900 },
    ];
    const session = createDuel({ seed: 92, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    const result = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("force attack " .. tostring(Duel.ForceAttack(attacker,target)))
      Debug.Message("force attacker " .. Duel.GetAttacker():GetCode() .. "/" .. Duel.GetAttackTarget():GetCode())
      `,
      "force-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["force attack true", "force attacker 100/200"]);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(6700);
  });

  it("lets Lua scripts inspect battle position and destruction status", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Battle Position Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Battle Position Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 1, cardReader: createCardReader(cards) });
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_GRAVE, 1, 1, nil):GetFirst()
      Debug.Message("battle position " .. attacker:GetBattlePosition() .. "/" .. target:GetBattlePosition() .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("battle destroyed " .. tostring(attacker:IsBattleDestroyed()) .. "/" .. tostring(target:IsBattleDestroyed()))
      `,
      "battle-position-destroyed.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("battle position 1/1/true/false");
    expect(host.messages).toContain("battle destroyed false/true");
  });

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

  it("lets Lua scripts detect effect damage operation info", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Damage Condition Probe", kind: "monster" }];
    const session = createDuel({ seed: 160, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Duel.SetOperationInfo(3,CATEGORY_DAMAGE,nil,1,1,500)
      Debug.Message("damcon damage " .. tostring(aux.damcon1(e,1,nil,0,3,nil,0,0)) .. "/" .. tostring(aux.damcon1(e,0,nil,0,3,nil,0,0)))
      local reverse_damage=Effect.GlobalEffect()
      reverse_damage:SetType(EFFECT_TYPE_FIELD)
      reverse_damage:SetCode(EFFECT_REVERSE_DAMAGE)
      reverse_damage:SetTargetRange(1,0)
      Duel.RegisterEffect(reverse_damage,0)
      Duel.SetOperationInfo(4,CATEGORY_DAMAGE,nil,1,0,900)
      Debug.Message("damcon reverse damage blocked " .. tostring(aux.damcon1(e,0,nil,0,4,nil,0,0)))
      local reverse_recover=Effect.GlobalEffect()
      reverse_recover:SetType(EFFECT_TYPE_FIELD)
      reverse_recover:SetCode(EFFECT_REVERSE_RECOVER)
      reverse_recover:SetTargetRange(1,0)
      Duel.RegisterEffect(reverse_recover,1)
      Duel.SetOperationInfo(5,CATEGORY_RECOVER,nil,1,1,700)
      Debug.Message("damcon recover reversed " .. tostring(aux.damcon1(e,1,nil,0,5,nil,0,0)))
      local no_damage=Effect.GlobalEffect()
      no_damage:SetType(EFFECT_TYPE_FIELD)
      no_damage:SetCode(EFFECT_NO_EFFECT_DAMAGE)
      no_damage:SetTargetRange(1,0)
      Duel.RegisterEffect(no_damage,0)
      Duel.SetOperationInfo(6,CATEGORY_DAMAGE,nil,1,0,900)
      Debug.Message("damcon no damage blocked " .. tostring(aux.damcon1(e,0,nil,0,6,nil,0,0)))
      `,
      "damage-condition.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("damcon damage true/false");
    expect(host.messages).toContain("damcon reverse damage blocked false");
    expect(host.messages).toContain("damcon recover reversed true");
    expect(host.messages).toContain("damcon no damage blocked false");
  });

  it("lets Lua scripts record attack cost payment status", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Cost Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 79, startingHandSize: 1, cardReader: createCardReader(cards) });
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

    const host = createLuaScriptHost(session);
    expect(applyResponse(session, { type: "declareAttack", player: 0, attackerUid: attacker!.uid, targetUid: target!.uid, label: "Attack" }).ok).toBe(true);
    const result = host.loadScript(
      `
      Debug.Message("attack cost initial " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid()
      Debug.Message("attack cost paid " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid(2)
      Debug.Message("attack cost canceled " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid(9)
      Debug.Message("attack cost clamped " .. Duel.IsAttackCostPaid())
      `,
      "attack-cost-paid.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["attack cost initial 0", "attack cost paid 1", "attack cost canceled 2", "attack cost clamped 2"]);
    expect(session.state.attackCostPaid).toBe(2);
    passBattleResponses(session);
    expect(session.state.attackCostPaid).toBe(0);
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateTrigger")).toBe(false);
    expect(applyResponse(session, trigger!).ok).toBe(true);
    const secondTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(secondTrigger).toBeDefined();
    expect(applyResponse(session, secondTrigger!).ok).toBe(true);
    expect(host.messages).toEqual(["aux bdocon attacker resolved", "aux bdogcon attacker resolved"]);
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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

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

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["direct battle monster self 100", "direct battle monster opponent nil true"]);
  });

  it("lets Lua scripts change the current attack target", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Retarget Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Original Target", kind: "monster", attack: 1000 },
      { code: "250", name: "Lua New Target", kind: "monster", attack: 500 },
      { code: "300", name: "Lua Retarget Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "250"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const originalTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    const newTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "250");
    expect(attacker).toBeDefined();
    expect(originalTarget).toBeDefined();
    expect(newTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, newTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.GetFieldCard(1,LOCATION_MZONE,1)
          Debug.Message("change target result " .. tostring(Duel.ChangeAttackTarget(target)))
          Debug.Message("changed target " .. Duel.GetAttackTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-change-attack-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["change target result true", "changed target 250"]);
    expect(session.state.currentAttack?.targetUid).toBe(newTarget!.uid);
    expect(session.state.pendingBattle?.targetUid).toBe(newTarget!.uid);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === originalTarget!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === newTarget!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(6700);
  });

  it("lets Lua scripts change the current attacker", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Original Attacker", kind: "monster", attack: 1800 },
      { code: "150", name: "Lua New Attacker", kind: "monster", attack: 2400 },
      { code: "200", name: "Lua Change Attacker Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Lua Change Attacker Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 55, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "150", "300"] },
      1: { main: ["200", "200"] },
    });
    startDuel(session);

    const originalAttacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const newAttacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "150");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(originalAttacker).toBeDefined();
    expect(newAttacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, originalAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, newAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
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
          local attacker=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,150),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
          Debug.Message("change attacker result " .. tostring(Duel.ChangeAttacker(attacker)))
          Debug.Message("changed attacker " .. Duel.GetAttacker():GetCode())
          Debug.Message("kept target " .. Duel.GetAttackTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-change-attacker.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === originalAttacker!.uid && candidate.targetUid === target!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["change attacker result true", "changed attacker 150", "kept target 200"]);
    expect(session.state.currentAttack?.attackerUid).toBe(newAttacker!.uid);
    expect(session.state.pendingBattle?.attackerUid).toBe(newAttacker!.uid);
    expect(session.state.currentAttack?.targetUid).toBe(target!.uid);
    expect(session.state.attacksDeclared).not.toContain(originalAttacker!.uid);
    expect(session.state.attacksDeclared).toContain(newAttacker!.uid);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === originalAttacker!.uid)?.location).toBe("monsterZone");
    expect(session.state.players[1].lifePoints).toBe(6600);
  });

  it("lets Lua scripts change the current attack to direct", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Direct Retarget Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Direct Original Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Lua Direct Retarget Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const originalTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("change direct result " .. tostring(Duel.ChangeAttackTarget(nil)))
          Debug.Message("changed target nil " .. tostring(Duel.GetAttackTarget()==nil))
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-change-attack-direct.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["change direct result true", "changed target nil true"]);
    expect(session.state.currentAttack?.targetUid).toBeUndefined();
    expect(session.state.pendingBattle?.targetUid).toBeUndefined();
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === originalTarget!.uid)?.location).toBe("monsterZone");
    expect(session.state.players[1].lifePoints).toBe(6200);
  });

  it("lets Lua scripts reopen the attacker with ChainAttack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Chain Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Chain Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Lua Chain Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
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
          Debug.Message("chain attack result " .. tostring(Duel.ChainAttack()))
          Debug.Message("chain attack cleared " .. tostring(Duel.GetAttacker()==nil))
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-chain-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["chain attack result true", "chain attack cleared true"]);
    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.attacksDeclared).not.toContain(attacker!.uid);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === target!.uid)).toBe(true);
  });

  it("lets Lua scripts chain attack a supplied target", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Chain Target Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Chain Original Target", kind: "monster", attack: 1000 },
      { code: "250", name: "Lua Chain New Target", kind: "monster", attack: 500 },
      { code: "300", name: "Lua Chain Target Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 54, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "250"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const originalTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    const newTarget = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "250");
    expect(attacker).toBeDefined();
    expect(originalTarget).toBeDefined();
    expect(newTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, newTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.GetFieldCard(1,LOCATION_MZONE,1)
          Debug.Message("chain target result " .. tostring(Duel.ChainAttack(target)))
          Debug.Message("chain target current " .. Duel.GetAttackTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-chain-attack-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);

    expect(host.messages).toEqual(["chain target result true", "chain target current 250"]);
    expect(session.state.currentAttack?.targetUid).toBe(newTarget!.uid);
    expect(session.state.pendingBattle?.targetUid).toBe(newTarget!.uid);
    expect(session.state.attacksDeclared).not.toContain(attacker!.uid);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === originalTarget!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === newTarget!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(6700);
  });

  it("offers Lua quick effects in their matching damage timing windows", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Timing Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Damage Step Quick", kind: "monster" },
      { code: "400", name: "Lua Damage Calculation Quick", kind: "monster" },
      { code: "500", name: "Lua Timing Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400"] },
      1: { main: ["500", "500", "500"] },
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
        e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("lua damage step quick " .. Duel.GetCurrentPhase() .. "/" .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsDamageCalculated()) .. "/" .. tostring(Duel.IsDamageCalculation()))
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetProperty(EFFECT_FLAG_DAMAGE_CAL)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("lua damage calculation quick " .. Duel.GetCurrentPhase() .. "/" .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsDamageCalculated()) .. "/" .. tostring(Duel.IsDamageCalculation()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-damage-timing-quick.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(session.state.battleStep).toBe("damage");

    expect(legalEffectCodes(session, 1)).toEqual([]);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["300"]);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);
    expect(host.messages).toContain("lua damage step quick 32/true/false/false");
    expect(session.state.battleStep).toBe("damage");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleStep).toBe("damageCalculation");

    expect(legalEffectCodes(session, 1)).toEqual([]);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["400"]);
    expect(applyResponse(session, activateEffectByCode(session, 0, "400")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);
    expect(host.messages).toContain("lua damage calculation quick 64/true/true/true");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingBattle).toBeUndefined();
    const endStep = host.loadScript(
      `
      Debug.Message("lua end step alias " .. tostring(Duel.IsEndStep()))
      `,
      "lua-end-step-alias.lua",
    );
    expect(endStep.ok, endStep.error).toBe(true);
    expect(host.messages).toContain("lua end step alias true");
  });

  it("lets Lua damage-calculation quick effects override final battle damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Damage Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Damage Override", kind: "monster" },
      { code: "500", name: "Lua Damage Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 48, startingHandSize: 2, cardReader: createCardReader(cards) });
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
        e:SetProperty(EFFECT_FLAG_DAMAGE_CAL)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("lua damage before " .. Duel.GetBattleDamage(1))
          Debug.Message("lua damage changed " .. Duel.ChangeBattleDamage(1, 600, false))
          Debug.Message("lua damage after " .. Duel.GetBattleDamage(1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-damage-override.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleStep).toBe("damageCalculation");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["300"]);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 600 });
    expect(host.messages).toEqual(["lua damage before 0", "lua damage changed 600", "lua damage after 600"]);

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.players[1].lifePoints).toBe(7400);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.pendingBattle).toBeUndefined();
  });
});

function legalEffectCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((candidate) => candidate.type === "activateEffect")
    .map((candidate) => session.state.cards.find((card) => card.uid === candidate.uid)?.code)
    .filter((code): code is string => code !== undefined);
}

function activateEffectByCode(session: ReturnType<typeof createDuel>, player: 0 | 1, code: string) {
  return getDuelLegalActions(session, player).find(
    (candidate) => candidate.type === "activateEffect" && session.state.cards.find((card) => card.uid === candidate.uid)?.code === code,
  );
}

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
