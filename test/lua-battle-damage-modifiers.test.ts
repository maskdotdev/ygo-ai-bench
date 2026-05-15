import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelCardInstance, DuelCardReader, DuelSession } from "#duel/types.js";
import type { LuaScriptSource } from "#lua/host.js";

describe("Lua battle damage modifiers", () => {
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(700);
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("applies targeted field piercing effects only to selected attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Piercing Source", kind: "monster", attack: 500 },
      { code: "200", name: "Piercing Granted", kind: "monster", attack: 2200 },
      { code: "300", name: "Piercing Open", kind: "monster", attack: 2200 },
      { code: "400", name: "Defense Target", kind: "monster", defense: 1500 },
      { code: "500", name: "Open Defense Target", kind: "monster", defense: 1500 },
    ];
    const session = createDuel({ seed: 145, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const granted = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    const open = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "400");
    const openTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "500");
    expect(source).toBeDefined();
    expect(granted).toBeDefined();
    expect(open).toBeDefined();
    expect(target).toBeDefined();
    expect(openTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, granted!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, open!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, openTarget!.uid, "monsterZone", 1).position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_PIERCE)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-piercing-battle-damage.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === granted!.uid && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(700);
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === open!.uid && candidate.targetUid === openTarget!.uid)!);
    passBattleResponses(session);

    expect(session.state.battleDamage[1]).toBe(0);
    expect(session.state.players[1].lifePoints).toBe(7300);
    expect(session.state.cards.find((card) => card.uid === openTarget!.uid)).toMatchObject({ location: "graveyard" });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("prioritizes turn-player field battle destroy redirects over earlier opponent redirects", () => {
    const { opponentSource, session, target, turnSource } = setupBattleDestroyRedirectPriorityFixture();

    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(session.state.cards.find((card) => card.uid === opponentSource!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === turnSource!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("restores turn-player field battle destroy redirect priority", () => {
    const { cardReader, opponentSource, scriptSource, session, target, turnSource } = setupBattleDestroyRedirectPriorityFixture();

    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), scriptSource, cardReader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(
      restored.session.state.effects
        .filter((effect) => effect.code === 204)
        .map((effect) => restored.session.state.cards.find((card) => card.uid === effect.sourceUid)?.code),
    ).toEqual(["300", "400"]);
    const restoredPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer)).toEqual(getGroupedDuelLegalActions(restored.session, restoredPlayer));
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, restoredPlayer),
    );
    passBattleResponses(restored.session);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSource!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === turnSource!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies targeted field battle destroy redirects only through selected destroyers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Selected Redirect Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Redirect Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Redirect Source", kind: "monster", attack: 500 },
      { code: "400", name: "Open Redirect Attacker", kind: "monster", attack: 1800 },
    ];
    const session = createDuel({ seed: 146, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const openAttacker = session.state.cards.find((card) => card.controller === 0 && card.code === "400");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(source).toBeDefined();
    expect(openAttacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, openAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
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
      "targeted-field-battle-destroy-redirect.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(
      session,
      getDuelLegalActions(session, 0).find(
        (candidate) => candidate.type === "declareAttack" && candidate.attackerUid === openAttacker!.uid && candidate.targetUid === target!.uid,
      )!,
    );
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", reason: 0x21 });
    expect(session.state.cards.find((card) => card.uid === openAttacker!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

interface BattleDestroyRedirectPriorityFixture {
  cardReader: DuelCardReader;
  opponentSource: DuelCardInstance;
  scriptSource: LuaScriptSource;
  session: DuelSession;
  target: DuelCardInstance;
  turnSource: DuelCardInstance;
}

function setupBattleDestroyRedirectPriorityFixture(): BattleDestroyRedirectPriorityFixture {
  const cards: DuelCardData[] = [
    { code: "100", name: "Redirect Priority Target", kind: "monster", attack: 1000 },
    { code: "200", name: "Redirect Priority Attacker", kind: "monster", attack: 1800 },
    { code: "300", name: "Opponent Redirect Source", kind: "monster", attack: 500 },
    { code: "400", name: "Turn Redirect Source", kind: "monster", attack: 500 },
  ];
  const cardReader = createCardReader(cards);
  const session = createDuel({ seed: 151, startingHandSize: 2, cardReader });
  loadDecks(session, {
    0: { main: ["100", "300"] },
    1: { main: ["200", "400"] },
  });
  startDuel(session);
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;

  const target = findPriorityCard(session, 0, "100");
  const opponentSource = findPriorityCard(session, 0, "300");
  const attacker = findPriorityCard(session, 1, "200");
  const turnSource = findPriorityCard(session, 1, "400");
  moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
  moveDuelCard(session.state, opponentSource.uid, "monsterZone", 0).position = "faceUpAttack";
  moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
  moveDuelCard(session.state, turnSource.uid, "monsterZone", 1).position = "faceUpAttack";

  const scriptSource = battleDestroyRedirectPriorityScriptSource();
  const host = createLuaScriptHost(session);
  const opponentLoaded = host.loadCardScript(300, scriptSource);
  const turnLoaded = host.loadCardScript(400, scriptSource);
  expect(opponentLoaded.ok, opponentLoaded.error).toBe(true);
  expect(turnLoaded.ok, turnLoaded.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  expectBattleDestroyRedirectEffectOrder(session, ["300", "400"]);

  return { cardReader, opponentSource, scriptSource, session, target, turnSource };
}

function battleDestroyRedirectPriorityScriptSource(): LuaScriptSource {
  return {
    readScript(name: string): string | undefined {
      if (name === "c300.lua") {
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_FIELD)
          e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
          e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
          e:SetRange(LOCATION_MZONE)
          e:SetTargetRange(1,0)
          e:SetValue(LOCATION_DECK)
          c:RegisterEffect(e)
        end
        `;
      }
      if (name === "c400.lua") {
        return `
        c400={}
        function c400.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_FIELD)
          e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
          e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
          e:SetRange(LOCATION_MZONE)
          e:SetTargetRange(0,1)
          e:SetValue(LOCATION_REMOVED)
          c:RegisterEffect(e)
        end
        `;
      }
      return undefined;
    },
  };
}

function findPriorityCard(session: DuelSession, controller: 0 | 1, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.controller === controller && candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectBattleDestroyRedirectEffectOrder(session: DuelSession, codes: string[]): void {
  expect(
    session.state.effects
      .filter((effect) => effect.code === 204)
      .map((effect) => session.state.cards.find((card) => card.uid === effect.sourceUid)?.code),
  ).toEqual(codes);
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

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
