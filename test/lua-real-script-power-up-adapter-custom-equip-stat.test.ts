import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const adapterCode = "78586116";
const morphtronicCode = "785861160";
const boostTargetCode = "785861161";
const responderCode = "785861162";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setMorphtronic = 0x26;

describe.skipIf(!hasUpstreamScripts)("Lua real script Power-Up Adapter custom equip stat", () => {
  it("restores RemainFieldCost equip into custom-event target ATK gain and attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${adapterCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCost(aux.RemainFieldCost)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_MORPHTRONIC)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,g,1,0,0)");
    expect(script).toContain("Duel.Equip(tp,c,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0,0)");
    expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,eq)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(eq:GetAttack())");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 78586116, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [adapterCode, morphtronicCode, boostTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const adapter = requireCard(session, adapterCode);
    const morphtronic = requireCard(session, morphtronicCode);
    const boostTarget = requireCard(session, boostTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, adapter.uid, "spellTrapZone", 0);
    adapter.faceUp = false;
    adapter.position = "faceDown";
    moveFaceUpAttack(session, morphtronic, 0);
    moveFaceUpAttack(session, boostTarget, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [adapterCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === adapter.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: adapter.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [morphtronic.uid],
        operationInfos: [{ category: 0x40000, targetUids: [morphtronic.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("power-up adapter responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === adapter.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: morphtronic.uid,
      cardTargetUids: [morphtronic.uid],
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: adapter.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        eventName: "customEvent",
        eventCode: 0x10000000 + Number(adapterCode),
        eventCardUid: adapter.uid,
        eventUids: [adapter.uid],
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: adapter.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        sourceUid: adapter.uid,
        effectId: "lua-2-347021572",
        player: 0,
        triggerBucket: "turnMandatory",
        eventTriggerTiming: "when",
      },
    ]);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === adapter.uid && [76, 85].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
    }))).toEqual([
      { code: 85, reset: { flags: 33427456 } },
      { code: 76, reset: { flags: 33427456 } },
    ]);

    const restoredCustom = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredCustom);
    expectRestoredLegalActions(restoredCustom, 0);
    const trigger = getLuaRestoreLegalActions(restoredCustom, 0).find((action) => action.type === "activateTrigger" && action.uid === adapter.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredCustom, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCustom, trigger!);
    expect(restoredCustom.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-2-347021572",
        sourceUid: adapter.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "customEvent",
        eventCode: 0x10000000 + Number(adapterCode),
        eventCardUid: adapter.uid,
        eventUids: [adapter.uid],
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: adapter.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        targetFieldIds: [7],
        targetUids: [boostTarget.uid],
      },
    ]);

    const restoredCustomChain = restoreDuelWithLuaScripts(serializeDuel(restoredCustom.session), source, reader);
    expectCleanRestore(restoredCustomChain);
    expectRestoredLegalActions(restoredCustomChain, 1);
    resolveRestoredChain(restoredCustomChain);
    expect(currentAttack(restoredCustomChain.session.state.cards.find((card) => card.uid === boostTarget.uid), restoredCustomChain.session.state)).toBe(2800);
    expect(restoredCustomChain.session.state.effects.filter((effect) => effect.sourceUid === boostTarget.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33427456 }, value: 1600 }]);
    expectLuaProbe(restoredCustomChain, "power-up adapter probe 78586116/785861160/true/2800");
  });
});

function cards(): DuelCardData[] {
  return [
    { code: adapterCode, name: "Power-Up Adapter", kind: "trap", typeFlags: typeTrap },
    { code: morphtronicCode, name: "Power-Up Adapter Morphtronic", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMorphtronic], level: 4, attack: 1600, defense: 1000 },
    { code: boostTargetCode, name: "Power-Up Adapter Boost Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: responderCode, name: "Power-Up Adapter Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("power-up adapter responder resolved") end)
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

function expectLuaProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${boostTargetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${adapterCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("power-up adapter probe " .. tostring(equip and equip:GetCode()) .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. target:GetAttack())
    `,
    "power-up-adapter-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  const message = restored.host.messages.find((candidate) => candidate === expected || candidate.startsWith("power-up adapter probe "));
  expect(restored.host.messages).toContain(message);
}
