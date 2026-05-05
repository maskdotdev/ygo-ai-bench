import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua attack negation helpers", () => {
  it("lets Lua scripts negate the active attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
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
      local attacker = Duel.GetAttacker()
      Debug.Message("before attacker " .. Duel.GetAttacker():GetCode())
      Debug.Message("before target " .. Duel.GetAttackTarget():GetCode())
      Debug.Message("negate active " .. tostring(Duel.NegateAttack()))
      Debug.Message("attack canceled status " .. tostring(attacker:IsStatus(STATUS_ATTACK_CANCELED)))
      Debug.Message("after attacker nil " .. tostring(Duel.GetAttacker() == nil))
      Debug.Message("negate empty " .. tostring(Duel.NegateAttack()))
      `,
      "negate-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("before attacker 100");
    expect(host.messages).toContain("before target 200");
    expect(host.messages).toContain("negate active true");
    expect(host.messages).toContain("attack canceled status true");
    expect(host.messages).toContain("after attacker nil true");
    expect(host.messages).toContain("negate empty false");
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(session.state.log.some((entry) => entry.action === "attack" && entry.detail === "Negated attack")).toBe(true);
  });

  it("lets Lua scripts negate a pending attack window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pending Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Pending Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: target!.uid };
    session.state.battleStep = "attack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attacker = Duel.GetAttacker()
      Debug.Message("pending attacker " .. attacker:GetCode() .. "/" .. Duel.GetAttackTarget():GetCode())
      Debug.Message("pending negate " .. tostring(Duel.NegateAttack()))
      Debug.Message("pending canceled " .. tostring(attacker:IsStatus(STATUS_ATTACK_CANCELED)))
      Debug.Message("pending after nil " .. tostring(Duel.GetAttacker() == nil))
      `,
      "negate-pending-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["pending attacker 100/200", "pending negate true", "pending canceled true", "pending after nil true"]);
    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.battleStep).toBeUndefined();
    expect(session.state.attackCanceledUids).toEqual([attacker!.uid]);
  });

  it("raises Lua attack-disabled triggers when an attack is negated", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Attack Disabled Listener", kind: "monster" },
    ];
    const session = createDuel({ seed: 130, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.currentAttack = { attackerUid: attacker!.uid, targetUid: target!.uid };
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: target!.uid };

    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_ATTACK_DISABLED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep)
          Debug.Message("attack disabled trigger " .. eg:GetFirst():GetCode() .. "/" .. ep)
        end)
        c:RegisterEffect(e)
      end
      `;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(300, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(`Debug.Message("negate disabled " .. tostring(Duel.NegateAttack()))`, "negate-disabled.lua");
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("negate disabled true");
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "attackDisabled", eventCode: 1142, eventCardUid: attacker!.uid, eventPlayer: 0 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "attackDisabled", eventCode: 1142, eventCardUid: attacker!.uid, eventPlayer: 0 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventName: "attackDisabled", eventCode: 1142, eventCardUid: attacker!.uid, eventPlayer: 0 });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    const restoredTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    const restoredTriggerResult = applyLuaRestoreResponse(restored, restoredTrigger!);
    expect(restoredTriggerResult.ok).toBe(true);
    expect(restoredTriggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, restoredTriggerResult.state.waitingFor!));
    expect(restoredTriggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, restoredTriggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("attack disabled trigger 100/0");

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("attack disabled trigger 100/0");
  });

  it("applies restored Lua attack-window quick effects through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Restore Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Restore Attack Negator", kind: "monster" },
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
          e:SetCondition(function(e,tp)
            return Duel.GetAttacker()~=nil
          end)
          e:SetOperation(function(e,tp)
            Debug.Message("restored attack negate " .. tostring(Duel.NegateAttack()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 146, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateEffect")).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    const negate = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect");
    const staleAttackPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passAttack");
    expect(negate).toBeDefined();
    expect(staleAttackPass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, negate!);

    expect(result.ok).toBe(true);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(["lua-1"]);
    const replayAttackPass = applyLuaRestoreResponse(restored, staleAttackPass!);
    expect(replayAttackPass.ok).toBe(false);
    expect(replayAttackPass.error).toContain("Response is not currently legal");
    expect(replayAttackPass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(replayAttackPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const passResult = applyLuaRestoreResponse(restored, pass!);
    expect(passResult.ok).toBe(true);
    expect(passResult.legalActions).toEqual(getDuelLegalActions(restored.session, passResult.state.waitingFor!));
    expect(passResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, passResult.state.waitingFor!));
    expect(restored.host.messages).toEqual(["restored attack negate true"]);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restored.session.state.eventHistory.some((event) => event.eventName === "attackDisabled")).toBe(true);
  });
});
