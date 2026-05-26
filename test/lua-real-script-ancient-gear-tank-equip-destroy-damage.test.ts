import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const setAncientGear = 0x7;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ancient Gear Tank equip destroy damage", () => {
  it("restores Ancient Gear Tank's setcode equip filter, stat boost, and destroyed Equip damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tankCode = "37457534";
    const ancientGearTargetCode = "37457535";
    const nonAncientGearDecoyCode = "37457536";
    const responderCode = "37457537";
    const script = workspace.readScript(`c${tankCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_ANCIENT_GEAR))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_EQUIP)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(600)");
    expect(script).toContain("e4:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e4:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsReason(REASON_DESTROY)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(600)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tankCode),
      { code: ancientGearTargetCode, name: "Ancient Gear Tank Ancient Gear Target", kind: "monster", typeFlags: typeMonster, setcodes: [setAncientGear], level: 4, attack: 1000, defense: 1000 },
      { code: nonAncientGearDecoyCode, name: "Ancient Gear Tank Non-Ancient Gear Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Ancient Gear Tank Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 37457534, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tankCode, ancientGearTargetCode, nonAncientGearDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tank = requireCard(session, tankCode);
    const ancientGearTarget = requireCard(session, ancientGearTargetCode);
    const nonAncientGearDecoy = requireCard(session, nonAncientGearDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, tank.uid, "hand", 0);
    moveDuelCard(session.state, ancientGearTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, nonAncientGearDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tankCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === tank.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
    expect(restoredEquipWindow.session.state.chain[0]!.operationInfos).toEqual([
      expect.objectContaining({ category: 0x40000, targetUids: [tank.uid], count: 1, player: 0, parameter: 0 }),
    ]);
    const restoredEquipChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredEquipChain);
    expectRestoredLegalActions(restoredEquipChain, 1);
    expect(getLuaRestoreLegalActions(restoredEquipChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredEquipChain, 1);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredEquipChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(getLuaRestoreLegalActions(restoredEquipped, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);
    expect(restoredEquipped.host.messages).not.toContain("ancient gear tank responder resolved");
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === tank.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: ancientGearTarget.uid,
      faceUp: true,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === tank.uid)?.equippedToUid).not.toBe(nonAncientGearDecoy.uid);
    const restoredTarget = restoredEquipped.session.state.cards.find((card) => card.uid === ancientGearTarget.uid)!;
    const restoredDecoy = restoredEquipped.session.state.cards.find((card) => card.uid === nonAncientGearDecoy.uid)!;
    expect(currentAttack(restoredTarget, restoredEquipped.session.state)).toBe(1600);
    expect(currentAttack(restoredDecoy, restoredEquipped.session.state)).toBe(1200);

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, 0);
    destroyDuelCard(restoredEquipState.session.state, tank.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === tank.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: ancientGearTarget.uid,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEquipState.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        sourceUid: tank.uid,
        effectId: "lua-4-1014",
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: tank.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tank.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === tank.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, triggerAction!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]!.operationInfos).toEqual([{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 600 }]);
    expect(restoredTriggerWindow.session.state.chain[0]!.targetParam).toBe(600);
    expect(restoredTriggerWindow.session.state.chain[0]!.targetPlayer).toBe(1);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, 1);
    expect(getLuaRestoreLegalActions(restoredDamageChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredDamageChain, 1);

    const restoredDamaged = restoreDuelWithLuaScripts(serializeDuel(restoredDamageChain.session), source, reader);
    expectCleanRestore(restoredDamaged);
    expectRestoredLegalActions(restoredDamaged, 0);
    expect(getLuaRestoreLegalActions(restoredDamaged, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);

    expect(restoredDamaged.session.state.players[1].lifePoints).toBe(7400);
    expect(restoredDamaged.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 600,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tank.uid,
        eventReasonEffectId: 4,
      },
    ]);
    expect(restoredDamaged.host.messages).not.toContain("ancient gear tank responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("ancient gear tank responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
