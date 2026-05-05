import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua battle timing helpers", () => {
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
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleStep).toBe("damageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    expect(legalEffectCodes(session, 1)).toEqual([]);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["400"]);
    expect(applyResponse(session, activateEffectByCode(session, 0, "400")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);
    expect(host.messages).toContain("lua damage calculation quick 64/true/true/true");

    passBattleResponses(session);
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
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleStep).toBe("damageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["300"]);
    expect(applyResponse(session, activateEffectByCode(session, 0, "300")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passChain")!).ok).toBe(true);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 600 });
    expect(host.messages).toEqual(["lua damage before 0", "lua damage changed 600", "lua damage after 600"]);

    passBattleResponses(session);
    expect(session.state.players[1].lifePoints).toBe(7400);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.pendingBattle).toBeUndefined();
  });

  it("applies restored Lua damage-calculation quick effects through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Damage Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Restore Damage Override", kind: "monster" },
      { code: "500", name: "Lua Restore Damage Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetProperty(EFFECT_FLAG_DAMAGE_CAL)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored damage before " .. Duel.GetBattleDamage(1))
            Debug.Message("restored damage changed " .. Duel.ChangeBattleDamage(1, 700, false))
            Debug.Message("restored damage after " .. Duel.GetBattleDamage(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 51, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["500", "500"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(legalEffectCodes(session, 0)).toEqual(["300"]);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyLuaRestoreAndAssert(restored, action!);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.session.state.battleDamage[1]).toBe(700);
    expect(restored.session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 700 });
    expect(restored.host.messages).toEqual(["restored damage before 0", "restored damage changed 700", "restored damage after 700"]);
    const damagePassPlayer = restored.session.state.waitingFor;
    if (damagePassPlayer === undefined) throw new Error("Expected restored damage window to wait for a player");
    const staleDamagePass = getLuaRestoreLegalActions(restored, damagePassPlayer).find((candidate) => candidate.type === "passDamage");
    expect(staleDamagePass).toBeDefined();
    applyLuaRestoreAndAssert(restored, staleDamagePass!);
    const replay = applyLuaRestoreResponse(restored, staleDamagePass!);
    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    const currentPlayer = restored.session.state.waitingFor;
    if (currentPlayer === undefined) throw new Error("Expected restored damage window replay to keep waiting for a player");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, currentPlayer));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, currentPlayer));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
  });

  it("queues Lua battle timing triggers before and after damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Timing Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Pre-Damage Trigger", kind: "monster" },
      { code: "300", name: "Lua Battled Trigger", kind: "monster" },
      { code: "400", name: "Lua Damage Step End Trigger", kind: "monster" },
      { code: "500", name: "Lua Damage Calculating Trigger", kind: "monster" },
      { code: "600", name: "Lua Battle End Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 49, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PRE_DAMAGE_CALCULATE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("lua pre damage calculate trigger resolved") end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("lua battled trigger resolved") end)
        c:RegisterEffect(e)
      end

      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_DAMAGE_STEP_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("lua damage step end trigger resolved") end)
        c:RegisterEffect(e)
      end

      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_DAMAGE_CALCULATING)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("lua damage calculating trigger resolved") end)
        c:RegisterEffect(e)
      end

      c600={}
      function c600.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("lua battle end trigger resolved") end)
        c:RegisterEffect(e)
      end
      `,
      "lua-battle-timing-triggers.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeDamageCalculation"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1134 });
    const preDamageTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(preDamageTrigger).toBeDefined();
    expect(applyResponse(session, preDamageTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua pre damage calculate trigger resolved");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageCalculating"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1135 });
    const damageCalculatingTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(damageCalculatingTrigger).toBeDefined();
    expect(applyResponse(session, damageCalculatingTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua damage calculating trigger resolved");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1138 });
    const battledTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(battledTrigger).toBeDefined();
    expect(applyResponse(session, battledTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua battled trigger resolved");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleEnded", "damageStepEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1137 });
    expect(session.state.pendingTriggers[1]).toMatchObject({ eventCode: 1141 });
    const battleEndTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(battleEndTrigger).toBeDefined();
    expect(applyResponse(session, battleEndTrigger!).ok).toBe(true);
    const endTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(endTrigger).toBeDefined();
    expect(applyResponse(session, endTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua damage step end trigger resolved");
    expect(host.messages).toContain("lua battle end trigger resolved");
  });

  it("applies restored Lua battle timing triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Timing Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Restore Pre-Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_PRE_DAMAGE_CALCULATE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored pre damage trigger " .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsDamageCalculation()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 52, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeDamageCalculation"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1134 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeDamageCalculation"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1134 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(trigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    applyLuaRestoreAndAssert(restored, trigger!);
    const staleTriggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTriggerResult.ok).toBe(false);
    expect(staleTriggerResult.error).toContain("Response is not currently legal");
    expect(staleTriggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, staleTriggerResult.state.waitingFor!));
    expect(staleTriggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleTriggerResult.state.waitingFor!));
    expect(staleTriggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTriggerResult.legalActions);

    expect(restored.host.messages).toEqual(["restored pre damage trigger true/false"]);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeDefined();
    expect(restored.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(queryPublicState(restored.session)).toMatchObject({ windowKind: "battle", waitingFor: 1, battleWindow: { kind: "beforeDamageCalculation", responsePlayer: 1 } });
    expect(getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passDamage")).toMatchObject({ windowId: restored.session.state.actionWindowId, windowKind: "battle" });
  });

  it("applies restored Lua after-damage battle triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore After-Damage Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Restore Battled Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLED)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored battled trigger " .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsDamageCalculated()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1138 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1138 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(trigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    applyLuaRestoreAndAssert(restored, trigger!);

    expect(restored.host.messages).toEqual(["restored battled trigger true/false"]);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeDefined();
    expect(restored.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(queryPublicState(restored.session)).toMatchObject({ windowKind: "battle", waitingFor: 1, battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passDamage")).toMatchObject({ windowId: restored.session.state.actionWindowId, windowKind: "battle" });
  });

  it("applies restored Lua battle-end triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Battle-End Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Lua Restore Battle-End Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_END)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored battle end trigger " .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsEndStep()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 57, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: [] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    passBattleUntilTrigger(session);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1137 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleEnded"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1137 });
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toEqual(["restored battle end trigger true/false"]);
  });

  it("applies restored Lua damage-step-end triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore End-Step Attacker", kind: "monster", attack: 1800 },
      { code: "400", name: "Lua Restore Damage Step End Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c400.lua") return undefined;
        return `
        c400={}
        function c400.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_DAMAGE_STEP_END)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored damage step end trigger " .. tostring(Duel.IsDamageStep()) .. "/" .. tostring(Duel.IsEndStep()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 54, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageStepEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1141 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageStepEnded"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1141 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(trigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    applyLuaRestoreAndAssert(restored, trigger!);

    expect(restored.host.messages).toEqual(["restored damage step end trigger true/false"]);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeDefined();
    expect(restored.session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(queryPublicState(restored.session)).toMatchObject({ windowKind: "battle", waitingFor: 1, battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passDamage")).toMatchObject({ windowId: restored.session.state.actionWindowId, windowKind: "battle" });
  });

  it("applies restored Lua battle-damage triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Restore Battle Damage Attacker", kind: "monster", attack: 1800 },
      { code: "500", name: "Lua Restore Battle Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c500.lua") return undefined;
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored battle damage trigger " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetLP(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 55, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    passBattleResponses(session);
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(trigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    applyLuaRestoreAndAssert(restored, trigger!);

    expect(restored.host.messages).toEqual(["restored battle damage trigger 1/1800/32/0/6200"]);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.players[1].lifePoints).toBe(6200);
    expect(queryPublicState(restored.session)).toMatchObject({ windowKind: "open", waitingFor: 0 });
    expect(queryPublicState(restored.session)).not.toHaveProperty("battleWindow");
    expect(getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "main2")).toMatchObject({
      windowId: restored.session.state.actionWindowId,
      windowKind: "open",
    });
  });

  it("queues Lua battle damage triggers after battle damage is applied", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Battle Damage Attacker", kind: "monster", attack: 1800 },
      { code: "500", name: "Lua Battle Damage Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLE_DAMAGE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r) Debug.Message("lua battle damage trigger resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetLP(1)) end)
        c:RegisterEffect(e)
      end
      `,
      "lua-battle-damage-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });
    const damageTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(damageTrigger).toBeDefined();
    expect(applyResponse(session, damageTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua battle damage trigger resolved 1/1800/32/0/6200");
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

function passBattleUntilTrigger(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function passLuaBattleChain(session: ReturnType<typeof createDuel>): boolean {
  if (!session.state.chain.length) return true;
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  expect(pass).toBeDefined();
  return applyResponse(session, pass!).ok;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
