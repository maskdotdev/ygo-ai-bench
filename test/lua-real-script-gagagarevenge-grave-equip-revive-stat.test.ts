import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const revengeCode = "90673413";
const gagagaCode = "906734130";
const xyzCode = "906734131";
const responderCode = "906734132";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeEquip = 0x40000;
const typeXyz = 0x800000;
const setGagaga = 0x54;

describe.skipIf(!hasUpstreamScripts)("Lua real script Gagagarevenge grave equip revive stat", () => {
  it("restores Gagaga grave revival into equip relation, leave-field destroy, and lost-target Xyz attack gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${revengeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsSetCard(SET_GAGAGA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.Equip(tp,c,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
    expect(script).toContain("c:IsReason(REASON_LOST_TARGET) and c:IsReason(REASON_DESTROY) and tc:IsLocation(LOCATION_OVERLAY)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(300)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createGagagarevengeSession(reader, workspace);
    const revenge = requireCard(session, revengeCode);
    const gagaga = requireCard(session, gagagaCode);
    const xyz = requireCard(session, xyzCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, revenge.uid, "hand", 0);
    moveDuelCard(session.state, gagaga.uid, "graveyard", 0);
    moveFaceUpAttack(session, xyz, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(revengeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === revenge.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: revenge.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [gagaga.uid],
        operationInfos: [
          { category: 0x200, targetUids: [gagaga.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x40000, targetUids: [revenge.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gagagarevenge responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === gagaga.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: revenge.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === revenge.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: gagaga.uid,
      cardTargetUids: [gagaga.uid],
      faceUp: true,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gagaga.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: revenge.uid,
        eventReasonEffectId: 1,
        eventUids: [gagaga.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaProbe(restoredEquipped, "gagagarevenge probe 90673413/906734130/true");

    destroyDuelCard(restoredEquipped.session.state, revenge.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === revenge.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: gagaga.uid,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === gagaga.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: revenge.uid,
      reasonEffectId: 2,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === gagaga.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: gagaga.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: revenge.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const lostTargetSession = createGagagarevengeSession(reader, workspace);
    const lostRevenge = requireCard(lostTargetSession, revengeCode);
    const lostGagaga = requireCard(lostTargetSession, gagagaCode);
    const lostXyz = requireCard(lostTargetSession, xyzCode);
    moveDuelCard(lostTargetSession.state, lostRevenge.uid, "spellTrapZone", 0);
    moveFaceUpAttack(lostTargetSession, lostGagaga, 0);
    moveFaceUpAttack(lostTargetSession, lostXyz, 0);
    lostRevenge.equippedToUid = lostGagaga.uid;
    lostRevenge.cardTargetUids = [lostGagaga.uid];
    lostRevenge.faceUp = true;
    const lostHost = createLuaScriptHost(lostTargetSession, workspace);
    expect(lostHost.loadCardScript(Number(revengeCode), source).ok).toBe(true);
    expect(lostHost.registerInitialEffects()).toBe(1);
    moveDuelCard(lostTargetSession.state, lostGagaga.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    lostXyz.overlayUids = [lostGagaga.uid];
    destroyDuelCard(lostTargetSession.state, lostRevenge.uid, 0, duelReason.lostTarget | duelReason.destroy, 0);
    expect(lostTargetSession.state.cards.find((card) => card.uid === lostRevenge.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: lostGagaga.uid,
      reason: duelReason.lostTarget | duelReason.destroy,
    });
    expect(lostTargetSession.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: lostRevenge.uid,
        eventPlayer: 0,
        eventReason: duelReason.lostTarget | duelReason.destroy,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        sourceUid: lostRevenge.uid,
        effectId: "lua-3-1014",
        player: 0,
        triggerBucket: "turnMandatory",
        eventTriggerTiming: "when",
      },
    ]);

    const restoredLostTarget = restoreDuelWithLuaScripts(serializeDuel(lostTargetSession), source, reader);
    expectCleanRestore(restoredLostTarget);
    expectRestoredLegalActions(restoredLostTarget, 0);
    const trigger = getLuaRestoreLegalActions(restoredLostTarget, 0).find((action) => action.type === "activateTrigger" && action.uid === lostRevenge.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredLostTarget, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLostTarget, trigger!);
    resolveRestoredChain(restoredLostTarget);
    expect(currentAttack(restoredLostTarget.session.state.cards.find((card) => card.uid === lostXyz.uid), restoredLostTarget.session.state)).toBe(2300);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: revengeCode, name: "Gagagarevenge", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: gagagaCode, name: "Gagagarevenge Fixture Gagaga", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000, setcodes: [setGagaga] },
    { code: xyzCode, name: "Gagagarevenge Fixture Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 2000, defense: 2000 },
    { code: responderCode, name: "Gagagarevenge Fixture Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createGagagarevengeSession(reader: ReturnType<typeof createCardReader>, _workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 90673413, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [revengeCode, gagagaCode], extra: [xyzCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player).position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("gagagarevenge responder resolved") end)
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectLuaProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${gagagaCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${revengeCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipCode=equip and equip:GetCode() or "nil"
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("gagagarevenge probe " .. equipCode .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil and equipTarget==target))
    `,
    "gagagarevenge-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
