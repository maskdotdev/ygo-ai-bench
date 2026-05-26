import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const assaultCode = "87043568";
const attackerCode = "870435680";
const defenderCode = "870435681";
const costMonsterCode = "870435682";
const responderCode = "870435683";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts)("Lua real script Assault Spirits damage-step equip stat", () => {
  it("restores RemainFieldCost equip into Damage Step hand-cost attack gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${assaultCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCost(aux.RemainFieldCost)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.Equip(tp,c,tc)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetHintTiming(TIMING_DAMAGE_STEP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("return a==e:GetHandler():GetEquipTarget()");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_HAND,0,1,nil)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetAttack())");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(e:GetLabel())");
    expect(script).toContain("e2:SetCode(EFFECT_EQUIP_LIMIT)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 87043568, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [assaultCode, attackerCode, costMonsterCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const assault = requireCard(session, assaultCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    const costMonster = requireCard(session, costMonsterCode);
    const responder = requireCard(session, responderCode);
    const setAssault = moveDuelCard(session.state, assault.uid, "spellTrapZone", 0);
    setAssault.faceUp = false;
    setAssault.position = "faceDown";
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, defender, 1);
    moveDuelCard(session.state, costMonster.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(assaultCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === assault.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: assault.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [attacker.uid],
        operationInfos: [{ category: 0x40000, targetUids: [assault.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("assault spirits responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === assault.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: attacker.uid,
      cardTargetUids: [attacker.uid],
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: assault.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === assault.uid).map((effect) => ({
      id: effect.id,
      event: effect.event,
      code: effect.code,
      property: effect.property,
      range: effect.range,
      registryKey: effect.registryKey,
      condition: effect.luaConditionDescriptor,
      reset: effect.reset,
    }))).toEqual([
      { id: "lua-1-1002", event: "quick", code: 1002, property: 0x10, range: ["spellTrapZone"], registryKey: "lua:87043568:lua-1-1002", condition: undefined, reset: undefined },
      { id: "lua-4-1002", event: "quick", code: 1002, property: 0x4000, range: ["spellTrapZone"], registryKey: "lua:87043568:lua-4-1002", condition: undefined, reset: { flags: 33427456 } },
      { id: "lua-5-76", event: "continuous", code: 76, property: 0x400, range: ["spellTrapZone"], registryKey: "lua:87043568:lua-5-76", condition: undefined, reset: { flags: 33427456 } },
    ]);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaProbe(restoredEquipped, "assault spirits probe 87043568/870435680/true/1500");

    restoredEquipped.session.state.phase = "battle";
    restoredEquipped.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredEquipped, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipped, attack!);
    passRestoredBattleAction(restoredEquipped, 1, "passAttack");
    passRestoredBattleAction(restoredEquipped, 0, "passAttack");
    expect(restoredEquipped.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 1 });
    passRestoredBattleAction(restoredEquipped, 1, "passDamage");
    expect(restoredEquipped.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 0);
    const boost = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === assault.uid && action.effectId === "lua-4-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, boost!);
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: assault.uid,
      reasonEffectId: 4,
    });
    expect(restoredDamageStep.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-4-1002",
        sourceUid: assault.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        effectLabel: 700,
      },
    ]);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === costMonster.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costMonster.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: assault.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBoostChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), source, reader);
    expectCleanRestore(restoredBoostChain);
    expectRestoredLegalActions(restoredBoostChain, 1);
    expect(getLuaRestoreLegalActions(restoredBoostChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredBoostChain);
    expect(restoredBoostChain.host.messages).not.toContain("assault spirits responder resolved");
    expect(currentAttack(restoredBoostChain.session.state.cards.find((card) => card.uid === attacker.uid), restoredBoostChain.session.state)).toBe(2200);
    expect(restoredBoostChain.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, value: 700 }]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: assaultCode, name: "Assault Spirits", kind: "trap", typeFlags: typeTrap },
    { code: attackerCode, name: "Assault Spirits Equipped Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    { code: defenderCode, name: "Assault Spirits Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1900, defense: 1000 },
    { code: costMonsterCode, name: "Assault Spirits Cost Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 700, defense: 1000 },
    { code: responderCode, name: "Assault Spirits Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("assault spirits responder resolved") end)
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function expectLuaProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${assaultCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("assault spirits probe " .. tostring(equip and equip:GetCode()) .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. equipTarget:GetAttack())
    `,
    "assault-spirits-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  const message = restored.host.messages.find((candidate) => candidate === expected || candidate.startsWith("assault spirits probe "));
  expect(restored.host.messages).toContain(message);
}
