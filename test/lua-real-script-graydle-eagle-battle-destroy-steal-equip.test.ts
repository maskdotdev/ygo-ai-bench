import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const graydleCode = "29834183";
const targetCode = "298341830";
const responderCode = "298341831";
const typeMonster = 0x1;
const typeEffect = 0x20;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Graydle Eagle battle-destroy steal equip", () => {
  it("restores its destroyed-to-Grave target prompt into equip control and leave-field return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${graydleCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP+CATEGORY_LEAVE_GRAVE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("c:IsReason(REASON_BATTLE)");
    expect(script).toContain("c:IsReason(REASON_DESTROY) and c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.CheckStealEquip,tp,0,LOCATION_MZONE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.Equip(tp,c,tc,true)");
    expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e4:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === graydleCode),
      { code: targetCode, name: "Graydle Eagle Fixture Steal Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Graydle Eagle Fixture Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29834183, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graydleCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const graydle = requireCard(session, graydleCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, graydle, 0);
    moveFaceUpAttack(session, target, 1);
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
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(graydleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    destroyDuelCard(restoredOpen.session.state, graydle.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === graydle.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1014",
        eventCardUid: graydle.uid,
        eventCode: eventToGrave,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: graydle.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graydle.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1014",
        sourceUid: graydle.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "sentToGraveyard",
        eventCode: eventToGrave,
        eventPlayer: 0,
        eventCardUid: graydle.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        targetFieldIds: [5],
        targetUids: [target.uid],
        operationInfos: [
          { category: 262144, targetUids: [graydle.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x4000000, targetUids: [graydle.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);
    expect(JSON.stringify(restoredTrigger.session.state.chain)).toContain('"category":262144');

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("graydle eagle responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === graydle.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaGraydleProbe(restoredEquipped, targetCode, graydleCode, "graydle probe 0/29834183/298341830/true");

    sendDuelCardToGraveyard(restoredEquipped.session.state, graydle.uid, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === graydle.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: graydle.uid,
      reasonEffectId: 1,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === graydle.uid).at(-1)).toEqual({
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventCardUid: graydle.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: graydle.uid,
      eventReasonEffectId: 1,
      eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
    });

    const restoredReturned = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredReturned);
    expectRestoredLegalActions(restoredReturned, 0);
    expectLuaGraydleProbe(restoredReturned, targetCode, graydleCode, "graydle probe nil/nil/nil/nil");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("graydle eagle responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaGraydleProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, graydleCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target0=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local target1=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local target=target0 or target1
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${graydleCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipCode=equip and equip:GetCode() or "nil"
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      local targetControl=target and target:GetControler() or "nil"
      Debug.Message("graydle probe " .. targetControl .. "/" .. equipCode .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
    `,
    "graydle-eagle-equip-control-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
