import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua battle state helpers", () => {
  it("applies Lua cannot-direct-attack effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "No Direct Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 121, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
  });

  it("applies Lua cannot-attack-announce effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Announcement Locked Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 122, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
  });

  it("applies targeted field cannot-attack effects only to selected attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Lock Source", kind: "monster", attack: 1000 },
      { code: "200", name: "Attack Locked", kind: "monster", attack: 1800 },
      { code: "300", name: "Attack Open", kind: "monster", attack: 1800 },
    ];
    const session = createDuel({ seed: 129, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    const locked = session.state.cards.find((card) => card.code === "200");
    const open = session.state.cards.find((card) => card.code === "300");
    expect(locked).toBeDefined();
    expect(open).toBeDefined();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-cannot-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    const query = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local open=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("targeted attack predicates " .. tostring(locked:CanAttack()) .. "/" .. tostring(open:CanAttack()))
      `,
      "targeted-cannot-attack-check.lua",
    );
    expect(query.ok, query.error).toBe(true);
    expect(host.messages).toEqual(["targeted attack predicates false/true"]);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === locked!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === open!.uid)).toBe(true);
  });

  it("applies targeted field cannot-direct-attack effects only to selected attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Direct Lock Source", kind: "monster", attack: 1000 },
      { code: "200", name: "Direct Locked", kind: "monster", attack: 1800 },
      { code: "300", name: "Direct Open", kind: "monster", attack: 1800 },
    ];
    const session = createDuel({ seed: 130, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    const locked = session.state.cards.find((card) => card.code === "200");
    const open = session.state.cards.find((card) => card.code === "300");
    expect(locked).toBeDefined();
    expect(open).toBeDefined();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-cannot-direct-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === locked!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === open!.uid)).toBe(true);
  });

  it("applies targeted field battle-target effects only to selected defenders", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Target Lock Source", kind: "monster", attack: 1000 },
      { code: "200", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Protected Target", kind: "monster", attack: 1000 },
      { code: "400", name: "Open Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 131, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    const protectedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    const openTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "400");
    expect(source).toBeDefined();
    expect(attacker).toBeDefined();
    expect(protectedTarget).toBeDefined();
    expect(openTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, protectedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, openTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(300) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-cannot-be-battle-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === protectedTarget!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === openTarget!.uid)).toBe(true);
  });

  it("applies Lua must-attack-monster target predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Magnetic Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Allowed Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Blocked Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
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
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === guardedTarget!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === openTarget!.uid)).toBe(false);
  });

  it("applies targeted field only-be-attacked effects only to selected defenders", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Only Be Attacked Source", kind: "monster", attack: 1000 },
      { code: "200", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Guarded Target", kind: "monster", attack: 1000 },
      { code: "400", name: "Open Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 136, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    const guardedTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    const openTarget = session.state.cards.find((card) => card.controller === 1 && card.code === "400");
    expect(source).toBeDefined();
    expect(attacker).toBeDefined();
    expect(guardedTarget).toBeDefined();
    expect(openTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, guardedTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, openTarget!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_ONLY_BE_ATTACKED)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(300) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-only-be-attacked.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === guardedTarget!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.targetUid === openTarget!.uid)).toBe(false);
  });

  it("applies Lua first-attack restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Later Attacker", kind: "monster", attack: 1600 },
    ];
    const session = createDuel({ seed: 125, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === firstAttacker!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === laterAttacker!.uid)).toBe(false);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === firstAttacker!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === laterAttacker!.uid)).toBe(true);
  });

  it("applies targeted field first-attack effects only to selected attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Attack Source", kind: "monster", attack: 1000 },
      { code: "200", name: "First Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Later Attacker", kind: "monster", attack: 1600 },
    ];
    const session = createDuel({ seed: 137, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    const firstAttacker = session.state.cards.find((card) => card.code === "200");
    const laterAttacker = session.state.cards.find((card) => card.code === "300");
    expect(firstAttacker).toBeDefined();
    expect(laterAttacker).toBeDefined();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_FIRST_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-first-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === firstAttacker!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === laterAttacker!.uid)).toBe(false);
  });

  it("applies Lua must-attack phase restrictions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Compulsory Attacker", kind: "monster", attack: 1800 }];
    const session = createDuel({ seed: 126, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePhase")).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "endTurn")).toBe(false);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePhase")).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "endTurn")).toBe(true);
  });

  it("applies targeted field extra-attack effects only to selected attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Attack Source", kind: "monster", attack: 1000 },
      { code: "200", name: "Extra Attack Granted", kind: "monster", attack: 1800 },
      { code: "300", name: "Extra Attack Ungranted", kind: "monster", attack: 1800 },
    ];
    const session = createDuel({ seed: 135, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    const granted = session.state.cards.find((card) => card.code === "200");
    const ungranted = session.state.cards.find((card) => card.code === "300");
    expect(granted).toBeDefined();
    expect(ungranted).toBeDefined();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_EXTRA_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        e:SetValue(1)
        c:RegisterEffect(e)
      end
      `,
      "targeted-extra-attack.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === granted!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === granted!.uid)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === ungranted!.uid)!);
    passBattleResponses(session);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === ungranted!.uid)).toBe(false);
  });

  it("passes the battle opponent to Lua indestructible battle value callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Indestructible Check Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Indestructible Check Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
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
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
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
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400"] } });
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
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
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200", "400"] } });
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
      atk_a:UpdateAttack(200, RESETS_STANDARD_PHASE_END)
      def_t:UpdateDefense(100, RESETS_STANDARD_PHASE_END)
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
    expect(host.messages).toContain("calc attack 1000");
    expect(host.messages).toContain("calc attack damage 1000/7000");
    expect(host.messages).toContain("calc defense 600");
    expect(host.messages).toContain("calc defense damage 600/7400");
    expect(host.messages).toContain("calc override 300");
    expect(host.messages).toContain("calc override damage 300/7100");
    expect(session.state.players[0].lifePoints).toBe(7100);
    expect(session.state.players[1].lifePoints).toBe(7000);
  });

  it("lets Lua scripts force an attack between monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Forced Attacker", kind: "monster", attack: 2200 },
      { code: "200", name: "Forced Target", kind: "monster", attack: 900 },
    ];
    const session = createDuel({ seed: 92, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    passBattleResponses(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_GRAVE, 1, 1, nil):GetFirst()
      Debug.Message("battle position " .. attacker:GetBattlePosition() .. "/" .. target:GetBattlePosition() .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP_DEFENSE,POS_FACEUP_ATTACK)) .. "/" .. tostring(target:IsBattlePosition({POS_FACEUP_DEFENSE,POS_FACEUP_ATTACK})) .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP)) .. "/" .. tostring(target:IsBattlePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("battle destroyed " .. tostring(attacker:IsBattleDestroyed()) .. "/" .. tostring(target:IsBattleDestroyed()))
      `,
      "battle-position-destroyed.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("battle position 1/1/true/true/true/true/false");
    expect(host.messages).toContain("battle destroyed false/true");
  });

  it("lets Lua cards inspect their current battle target", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Target Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Battle Target Defender", kind: "monster", attack: 1000 },
      { code: "300", name: "Idle Monster", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 133, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const idle = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(idle).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, idle!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.currentAttack = { attackerUid: attacker!.uid, targetUid: target!.uid };
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: target!.uid };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local idle=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("card battle target attacker " .. attacker:GetBattleTarget():GetCode())
      Debug.Message("card battle target defender " .. target:GetBattleTarget():GetCode())
      Debug.Message("card battle target idle nil " .. tostring(idle:GetBattleTarget()==nil))
      `,
      "card-battle-target.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card battle target attacker 200");
    expect(host.messages).toContain("card battle target defender 100");
    expect(host.messages).toContain("card battle target idle nil true");
  });

  it("marks both monsters as opposing battle participants for Lua status checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Status Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Status Defender", kind: "monster", attack: 1000 },
      { code: "300", name: "Status Idle", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 135, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const idle = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(idle).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, idle!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: target!.uid };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local idle=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("oppo battle duel cards " .. Duel.GetAttacker():GetCode() .. "/" .. Duel.GetAttackTarget():GetCode())
      Debug.Message("oppo battle attacker " .. tostring(attacker:IsRelateToBattle()) .. "/" .. tostring(attacker:IsStatus(STATUS_OPPO_BATTLE)))
      Debug.Message("oppo battle target " .. tostring(target:IsRelateToBattle()) .. "/" .. tostring(target:IsStatus(STATUS_OPPO_BATTLE)))
      Debug.Message("oppo battle idle " .. tostring(idle:IsRelateToBattle()) .. "/" .. tostring(idle:IsStatus(STATUS_OPPO_BATTLE)))
      `,
      "opposing-battle-status.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "oppo battle duel cards 100/200",
      "oppo battle attacker true/true",
      "oppo battle target true/true",
      "oppo battle idle false/false",
    ]);
  });

  it("tracks attacked monsters for Lua battle history queries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "History Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "History Target", kind: "monster", attack: 1000 },
      { code: "300", name: "History Idle", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 134, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const idle = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(idle).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, idle!.uid, "monsterZone", 1).position = "faceUpAttack";

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local g=Duel.GetAttackedGroup()
      Debug.Message("attacked group count " .. g:GetCount())
      Debug.Message("attacked group has target " .. tostring(g:IsContains(Duel.GetAttackTarget())))
      local idle=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("attacked group has idle " .. tostring(g:IsContains(idle)))
      local attacker=Duel.GetAttacker()
      local target=Duel.GetAttackTarget()
      Debug.Message("attacker battled " .. attacker:GetBattledGroupCount() .. "/" .. attacker:GetAttackedCount() .. "/" .. tostring(attacker:GetBattledGroup():IsContains(target)))
      Debug.Message("target battled " .. target:GetBattledGroupCount() .. "/" .. target:GetAttackedCount() .. "/" .. tostring(target:GetBattledGroup():IsContains(attacker)))
      `,
      "attacked-group.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("attacked group count 1");
    expect(host.messages).toContain("attacked group has target true");
    expect(host.messages).toContain("attacked group has idle false");
    expect(host.messages).toContain("attacker battled 1/1/true");
    expect(host.messages).toContain("target battled 1/0/true");

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.attackedTargetUids).toEqual([target!.uid]);
    expect(restored.state.battlePairs).toEqual([{ attackerUid: attacker!.uid, targetUid: target!.uid }]);
  });
});

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
