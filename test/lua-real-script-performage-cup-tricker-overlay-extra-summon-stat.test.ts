import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cupCode = "6812770";
const pzoneXyzCode = "68127700";
const extraSearchCode = "68127701";
const extraTriggerCode = "68127702";
const handXyzCode = "68127703";
const handMaterialCode = "68127704";
const costXyzCode = "68127705";
const receiveXyzCode = "68127706";
const spareMaterialCode = "68127707";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCupScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cupCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setPerformage = 0xc6;
const effectUpdateAttack = 100;
const eventDetachMaterial = 1202;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCupScript)("Lua real script Performage Cup Tricker overlay extra summon stat", () => {
  it("restores P-zone overlay attach, Extra Deck search trigger, hand detach summon ATK loss, and material transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cupCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredAttach = createRestoredCupField({ mode: "pzoneAttach", reader, source: workspace, workspace });
    expectCleanRestore(restoredAttach);
    expectRestoredLegalActions(restoredAttach, 0);
    const pzoneCup = requireCard(restoredAttach.session, cupCode);
    const pzoneXyz = requireCard(restoredAttach.session, pzoneXyzCode);
    const attach = getLuaRestoreLegalActions(restoredAttach, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pzoneCup.uid
    );
    expect(attach, JSON.stringify(getLuaRestoreLegalActions(restoredAttach, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttach, attach!);
    resolveRestoredChain(restoredAttach);
    expect(restoredAttach.session.state.cards.find((card) => card.uid === pzoneCup.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pzoneCup.uid,
      reasonEffectId: 3,
    });
    expect(restoredAttach.session.state.cards.find((card) => card.uid === pzoneXyz.uid)?.overlayUids).toEqual([pzoneCup.uid]);

    const restoredExtraOpen = createRestoredCupField({ mode: "extraSearch", reader, source: workspace, workspace });
    expectCleanRestore(restoredExtraOpen);
    expectRestoredLegalActions(restoredExtraOpen, 0);
    const extraCup = requireCard(restoredExtraOpen.session, cupCode);
    const extraSearch = requireCard(restoredExtraOpen.session, extraSearchCode);
    const extraTrigger = requireCard(restoredExtraOpen.session, extraTriggerCode);
    destroyDuelCard(restoredExtraOpen.session.state, extraTrigger.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredExtraOpen.session.state.cards.find((card) => card.uid === extraTrigger.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredExtraOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1013", eventCardUid: extraTrigger.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: extraCup.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredExtra = restoreDuelWithLuaScripts(serializeDuel(restoredExtraOpen.session), workspace, reader);
    expectCleanRestore(restoredExtra);
    expectRestoredLegalActions(restoredExtra, 0);
    const search = getLuaRestoreLegalActions(restoredExtra, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === extraCup.uid
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredExtra, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredExtra, search!);
    resolveRestoredChain(restoredExtra);
    expect(restoredExtra.session.state.cards.find((card) => card.uid === extraSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: extraCup.uid,
      reasonEffectId: 4,
    });
    expect(restoredExtra.host.messages).toContain(`confirmed 1: ${extraSearchCode}`);
    expect(restoredExtra.session.state.eventHistory.filter((event) => ["sentToDeck", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: extraTrigger.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "extraDeck" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: extraSearch.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: extraCup.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: extraSearch.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: extraCup.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: extraSearch.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: extraCup.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
    ]);

    const restoredHand = createRestoredCupField({ mode: "handSummon", reader, source: workspace, workspace });
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    const handCup = requireCard(restoredHand.session, cupCode);
    const handXyz = requireCard(restoredHand.session, handXyzCode);
    const handMaterial = requireCard(restoredHand.session, handMaterialCode);
    const handSummon = getLuaRestoreLegalActions(restoredHand, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handCup.uid && action.effectId === "lua-5"
    );
    expect(handSummon, JSON.stringify(getLuaRestoreLegalActions(restoredHand, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHand, handSummon!);
    resolveRestoredChain(restoredHand);
    expect(restoredHand.session.state.cards.find((card) => card.uid === handMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handCup.uid,
      reasonEffectId: 5,
    });
    expect(restoredHand.session.state.cards.find((card) => card.uid === handCup.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handCup.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredHand.session.state.cards.find((card) => card.uid === handXyz.uid), restoredHand.session.state)).toBe(1800);
    expect(restoredHand.session.state.effects.filter((effect) => effect.sourceUid === handXyz.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: handXyz.uid, value: -600 },
    ]);
    expect(restoredHand.session.state.eventHistory.filter((event) => ["becameTarget", "detachedMaterial", "sentToGraveyard", "specialSummoned", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: handXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 5, previous: "extraDeck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handMaterial.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handCup.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: eventDetachMaterial, eventCardUid: handMaterial.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handCup.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: handCup.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handCup.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handCup.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);

    const costSource = sourceWithCostXyz(workspace);
    const restoredCostOpen = createRestoredCupField({ mode: "detachedTransfer", reader, source: costSource, workspace });
    expectCleanRestore(restoredCostOpen);
    expectRestoredLegalActions(restoredCostOpen, 0);
    const costCup = requireCard(restoredCostOpen.session, cupCode);
    const costXyz = requireCard(restoredCostOpen.session, costXyzCode);
    const receiveXyz = requireCard(restoredCostOpen.session, receiveXyzCode);
    const spareMaterial = requireCard(restoredCostOpen.session, spareMaterialCode);
    const detachCost = getLuaRestoreLegalActions(restoredCostOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === costXyz.uid
    );
    expect(detachCost, JSON.stringify(getLuaRestoreLegalActions(restoredCostOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCostOpen, detachCost!);
    resolveRestoredChain(restoredCostOpen);
    expect(restoredCostOpen.session.state.cards.find((card) => card.uid === costCup.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: costXyz.uid,
      reasonEffectId: 7,
    });
    expect(restoredCostOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-6-1014", eventCardUid: costCup.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: costXyz.uid, eventReasonEffectId: 7, player: 0, sourceUid: costCup.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredTransfer = restoreDuelWithLuaScripts(serializeDuel(restoredCostOpen.session), costSource, reader);
    expectCleanRestore(restoredTransfer);
    expectRestoredLegalActions(restoredTransfer, 0);
    const transfer = getLuaRestoreLegalActions(restoredTransfer, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === costCup.uid
    );
    expect(transfer, JSON.stringify(getLuaRestoreLegalActions(restoredTransfer, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTransfer, transfer!);
    resolveRestoredChain(restoredTransfer);
    expect(restoredTransfer.session.state.cards.find((card) => card.uid === costXyz.uid)?.overlayUids).toEqual([]);
    expect(restoredTransfer.session.state.cards.find((card) => card.uid === receiveXyz.uid)?.overlayUids).toEqual([spareMaterial.uid]);
    expect(restoredTransfer.session.state.cards.find((card) => card.uid === spareMaterial.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: costCup.uid,
      reasonEffectId: 6,
    });
    expect(restoredTransfer.session.state.eventHistory.filter((event) => ["becameTarget", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: eventDetachMaterial, eventCardUid: costCup.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: costXyz.uid, eventReasonEffectId: 7, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: costXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 6, previous: "extraDeck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: receiveXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 6, previous: "extraDeck", current: "monsterZone" },
      { eventName: "detachedMaterial", eventCode: eventDetachMaterial, eventCardUid: costXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: costCup.uid, eventReasonEffectId: 6, relatedEffectId: 6, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restoredTransfer.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredCupField({
  mode,
  reader,
  source,
  workspace,
}: {
  mode: "pzoneAttach" | "extraSearch" | "handSummon" | "detachedTransfer";
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6812770 + mode.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  if (mode === "pzoneAttach") loadDecks(session, { 0: { main: [cupCode], extra: [pzoneXyzCode] }, 1: { main: [] } });
  if (mode === "extraSearch") loadDecks(session, { 0: { main: [cupCode, extraTriggerCode], extra: [extraSearchCode] }, 1: { main: [] } });
  if (mode === "handSummon") loadDecks(session, { 0: { main: [cupCode, handMaterialCode], extra: [handXyzCode] }, 1: { main: [] } });
  if (mode === "detachedTransfer") loadDecks(session, { 0: { main: [cupCode, spareMaterialCode], extra: [costXyzCode, receiveXyzCode] }, 1: { main: [] } });
  startDuel(session);

  if (mode === "pzoneAttach") {
    movePzone(session, requireCard(session, cupCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, pzoneXyzCode), 0, 0);
  }
  if (mode === "extraSearch") {
    movePzone(session, requireCard(session, cupCode), 0, 0);
    moveDuelCard(session.state, requireCard(session, extraSearchCode).uid, "extraDeck", 0).faceUp = true;
    moveFaceUpAttack(session, requireCard(session, extraTriggerCode), 0, 0);
  }
  if (mode === "handSummon") {
    moveDuelCard(session.state, requireCard(session, cupCode).uid, "hand", 0);
    const xyz = moveFaceUpAttack(session, requireCard(session, handXyzCode), 0, 0);
    attachOverlayMaterial(session, xyz, requireCard(session, handMaterialCode));
  }
  if (mode === "detachedTransfer") {
    const cup = requireCard(session, cupCode);
    const costXyz = moveFaceUpAttack(session, requireCard(session, costXyzCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, receiveXyzCode), 0, 1);
    attachOverlayMaterial(session, costXyz, cup);
    attachOverlayMaterial(session, costXyz, requireCard(session, spareMaterialCode));
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cupCode), source).ok).toBe(true);
  if (mode === "detachedTransfer") expect(host.loadCardScript(Number(costXyzCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(mode === "detachedTransfer" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Performage Cup Tricker");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("Duel.SelectTarget(tp,s.pendattachfilter,tp,LOCATION_MZONE,0,1,1,nil,tp,c)");
  expect(script).toContain("Duel.Overlay(tc,c)");
  expect(script).toContain("e2:SetCode(EVENT_TO_DECK)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_EXTRA)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("c:CheckRemoveOverlayCard(tp,1,REASON_EFFECT)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("tc:RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-600)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_COST) and re:IsActivated() and re:IsActiveType(TYPE_XYZ) and c:IsPreviousLocation(LOCATION_OVERLAY)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_TARGET)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.Overlay(attachxyz,attach_group)");
  expect(script).toContain("Duel.RaiseSingleEvent(detachxyz,EVENT_DETACH_MATERIAL,e,0,0,0,0)");
}

function sourceWithCostXyz(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${costXyzCode}.lua`) return costXyzScript();
      return workspace.readScript(name);
    },
  };
}

function costXyzScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return e:GetHandler():CheckRemoveOverlayCard(tp,1,REASON_COST) end
        e:GetHandler():RemoveOverlayCard(tp,1,1,REASON_COST)
      end)
      e:SetOperation(function(e,tp) Debug.Message("cup tricker cost xyz resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const cup = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cupCode);
  expect(cup).toBeDefined();
  return [
    cup!,
    xyzCard(pzoneXyzCode, "Cup Tricker Performage PZone Xyz", 2300, true),
    pendulumCard(extraSearchCode, "Cup Tricker Extra Search Target", true),
    pendulumCard(extraTriggerCode, "Cup Tricker Extra Trigger Pendulum", false),
    xyzCard(handXyzCode, "Cup Tricker Hand Summon Xyz", 2400, false),
    effectMonster(handMaterialCode, "Cup Tricker Hand Xyz Material", raceWarrior, 1000),
    xyzCard(costXyzCode, "Cup Tricker Cost Xyz", 2500, false),
    xyzCard(receiveXyzCode, "Cup Tricker Receive Xyz", 2200, false),
    effectMonster(spareMaterialCode, "Cup Tricker Spare Material", raceWarrior, 900),
  ];
}

function xyzCard(code: string, name: string, attack: number, performage: boolean): DuelCardData {
  return {
    code,
    name,
    kind: "extra",
    typeFlags: typeMonster | typeEffect | typeXyz,
    setcodes: performage ? [setPerformage] : [],
    race: raceSpellcaster,
    attribute: attributeLight,
    level: 4,
    attack,
    defense: 2000,
  };
}

function pendulumCard(code: string, name: string, performage: boolean): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | typePendulum,
    setcodes: performage ? [setPerformage] : [],
    race: raceSpellcaster,
    attribute: attributeLight,
    level: 4,
    attack: 1200,
    defense: 1400,
  };
}

function effectMonster(code: string, name: string, race: number, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race, attribute: attributeLight, level: 4, attack, defense: 1000 };
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attachOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  material.sequence = holder.overlayUids.length;
  holder.overlayUids.push(material.uid);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
