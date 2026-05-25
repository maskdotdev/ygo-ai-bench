import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const rocketHandCode = "13317419";
const equippedMonsterCode = "133174190";
const destroyTargetCode = "133174191";
const responderCode = "133174192";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rocket Hand equip cost final stat", () => {
  it("restores remain-field Trap equip into self-to-Grave cost, destruction, final ATK zero, and position lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rocketHandCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCost(aux.RemainFieldCost)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.Equip(tp,c,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rocketHandCode),
      { code: equippedMonsterCode, name: "Rocket Hand Equipped Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: destroyTargetCode, name: "Rocket Hand Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Rocket Hand Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13317419, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rocketHandCode, equippedMonsterCode] }, 1: { main: [destroyTargetCode, responderCode] } });
    startDuel(session);

    const rocketHand = requireCard(session, rocketHandCode);
    const equippedMonster = requireCard(session, equippedMonsterCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, rocketHand.uid, "spellTrapZone", 0).faceUp = false;
    moveDuelCard(session.state, equippedMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, destroyTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    for (const code of [rocketHandCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === rocketHand.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: rocketHand.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [equippedMonster.fieldId],
        targetUids: [equippedMonster.uid],
        operationInfos: [{ category: 0x40000, targetUids: [rocketHand.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("rocket hand responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === rocketHand.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: equippedMonster.uid,
      faceUp: true,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === equippedMonster.uid), restoredChain.session.state)).toBe(2000);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === rocketHand.uid && [76, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, registryKey: "lua:13317419:lua-5-100", reset: { flags: 33427456 }, value: 800 },
      { code: 76, registryKey: "lua:13317419:lua-6-76", reset: { flags: 33427456 }, value: 1 },
    ]);

    const costSession = createDuel({ seed: 13317420, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(costSession, { 0: { main: [rocketHandCode, destroyTargetCode] }, 1: { main: [equippedMonsterCode, responderCode] } });
    startDuel(costSession);
    const costRocketHand = requireCard(costSession, rocketHandCode);
    const costEquippedMonster = requireCard(costSession, equippedMonsterCode);
    const costDestroyTarget = requireCard(costSession, destroyTargetCode);
    const costResponder = requireCard(costSession, responderCode);
    const costEquip = moveDuelCard(costSession.state, costRocketHand.uid, "spellTrapZone", 0);
    costEquip.faceUp = true;
    costEquip.equippedToUid = costEquippedMonster.uid;
    moveDuelCard(costSession.state, costEquippedMonster.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(costSession.state, costDestroyTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(costSession.state, costResponder.uid, "hand", 1);
    costSession.state.phase = "main1";
    costSession.state.turnPlayer = 0;
    costSession.state.waitingFor = 0;
    const costHost = createLuaScriptHost(costSession, source);
    for (const code of [rocketHandCode, responderCode]) {
      const loaded = costHost.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(costHost.registerInitialEffects()).toBe(2);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(costSession), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    const destroy = getLuaRestoreLegalActions(restoredEquipped, 0).find((action) => action.type === "activateEffect" && action.uid === costRocketHand.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipped, destroy!);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === costRocketHand.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: costEquippedMonster.uid,
      reason: duelReason.cost,
      reasonPlayer: 0,
    });
    expect(restoredEquipped.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2-1002",
        effectLabelObjectUid: costEquippedMonster.uid,
        sourceUid: costRocketHand.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [costDestroyTarget.fieldId],
        targetUids: [costDestroyTarget.uid],
        operationInfos: [{ category: 0x1, targetUids: [costDestroyTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    expectRestoredLegalActions(restoredDestroyChain, 1);
    resolveRestoredChain(restoredDestroyChain);
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === costDestroyTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: costRocketHand.uid,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredDestroyChain.session.state.cards.find((card) => card.uid === costEquippedMonster.uid), restoredDestroyChain.session.state)).toBe(0);
    expect(restoredDestroyChain.session.state.effects.filter((effect) => effect.sourceUid === costEquippedMonster.uid && [14, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, registryKey: "lua:13317419:lua-4-102", reset: { flags: 33427456 }, value: 0 },
      { code: 14, registryKey: "lua:13317419:lua-5-14", reset: { flags: 33427456 }, value: undefined },
    ]);
    expect(restoredDestroyChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costRocketHand.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: costRocketHand.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: costDestroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: costRocketHand.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costDestroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: costRocketHand.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("rocket hand responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
