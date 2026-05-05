import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua battle retarget helpers", () => {
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

    expect(host.messages).toEqual(["change target result true", "changed target 250"]);
    expect(session.state.currentAttack?.targetUid).toBe(newTarget!.uid);
    expect(session.state.pendingBattle?.targetUid).toBe(newTarget!.uid);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === originalTarget!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === newTarget!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(6700);
  });

  it("applies restored Lua attack retarget quick effects through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Retarget Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Restore Original Target", kind: "monster", attack: 1000 },
      { code: "250", name: "Lua Restore New Target", kind: "monster", attack: 500 },
      { code: "300", name: "Lua Restore Retarget Probe", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetAttacker()~=nil end)
          e:SetOperation(function(e,tp)
            local target=Duel.GetFieldCard(1,LOCATION_MZONE,1)
            Debug.Message("restored change target " .. tostring(Duel.ChangeAttackTarget(target)))
            Debug.Message("restored target " .. Duel.GetAttackTarget():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 56, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200", "250"] } });
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
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect")).toBe(false);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });
    const quickResult = applyLuaRestoreAndAssert(restored, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.host.messages).toEqual(["restored change target true", "restored target 250"]);
    expect(restored.session.state.currentAttack?.targetUid).toBe(newTarget!.uid);
    expect(restored.session.state.pendingBattle?.targetUid).toBe(newTarget!.uid);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === originalAttacker!.uid && candidate.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

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

  it("applies restored Lua attacker-change quick effects through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Original Attacker", kind: "monster", attack: 1800 },
      { code: "150", name: "Lua Restore New Attacker", kind: "monster", attack: 2400 },
      { code: "200", name: "Lua Restore Change Attacker Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Lua Restore Change Attacker Probe", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetAttacker()~=nil end)
          e:SetOperation(function(e,tp)
            local attacker=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,150),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
            Debug.Message("restored change attacker " .. tostring(Duel.ChangeAttacker(attacker)))
            Debug.Message("restored attacker " .. Duel.GetAttacker():GetCode())
            Debug.Message("restored kept target " .. Duel.GetAttackTarget():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 57, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "150", "300"] }, 1: { main: ["200", "200"] } });
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
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === originalAttacker!.uid && candidate.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });
    applyLuaRestoreAndAssert(restored, quick!);
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.host.messages).toEqual(["restored change attacker true", "restored attacker 150", "restored kept target 200"]);
    expect(restored.session.state.currentAttack?.attackerUid).toBe(newAttacker!.uid);
    expect(restored.session.state.pendingBattle?.attackerUid).toBe(newAttacker!.uid);
    expect(restored.session.state.currentAttack?.targetUid).toBe(target!.uid);
    expect(restored.session.state.attacksDeclared).not.toContain(originalAttacker!.uid);
    expect(restored.session.state.attacksDeclared).toContain(newAttacker!.uid);
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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

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

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === originalTarget!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!);
    applyAndAssert(session, activateEffectByCode(session, 0, "300")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!);

    expect(host.messages).toEqual(["chain target result true", "chain target current 250"]);
    expect(session.state.currentAttack?.targetUid).toBe(newTarget!.uid);
    expect(session.state.pendingBattle?.targetUid).toBe(newTarget!.uid);
    expect(session.state.attacksDeclared).not.toContain(attacker!.uid);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === originalTarget!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === newTarget!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(6700);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
