import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
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
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyLuaRestoreResponse(restored, action!).ok).toBe(true);
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, pass!).ok).toBe(true);

    expect(restored.session.state.battleDamage[1]).toBe(700);
    expect(restored.session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 700 });
    expect(restored.host.messages).toEqual(["restored damage before 0", "restored damage changed 700", "restored damage after 700"]);
  });

  it("queues Lua battle timing triggers before and after damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Timing Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Lua Pre-Damage Trigger", kind: "monster" },
      { code: "300", name: "Lua Battled Trigger", kind: "monster" },
      { code: "400", name: "Lua Damage Step End Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 49, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
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
      `,
      "lua-battle-timing-triggers.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeDamageCalculation"]);
    const preDamageTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(preDamageTrigger).toBeDefined();
    expect(applyResponse(session, preDamageTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua pre damage calculate trigger resolved");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);
    const battledTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(battledTrigger).toBeDefined();
    expect(applyResponse(session, battledTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua battled trigger resolved");

    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passDamage")!).ok).toBe(true);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageStepEnded"]);
    const endTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(endTrigger).toBeDefined();
    expect(applyResponse(session, endTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua damage step end trigger resolved");
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
        e:SetOperation(function(e,tp) Debug.Message("lua battle damage trigger resolved " .. Duel.GetLP(1)) end)
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
    const damageTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(damageTrigger).toBeDefined();
    expect(applyResponse(session, damageTrigger!).ok).toBe(true);
    expect(passLuaBattleChain(session)).toBe(true);
    expect(host.messages).toContain("lua battle damage trigger resolved 6200");
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

function passLuaBattleChain(session: ReturnType<typeof createDuel>): boolean {
  if (!session.state.chain.length) return true;
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  expect(pass).toBeDefined();
  return applyResponse(session, pass!).ok;
}
