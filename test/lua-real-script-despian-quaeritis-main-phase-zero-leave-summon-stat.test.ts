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
const quaeritisCode = "72272462";
const despiaMaterialCode = "722724620";
const lightMaterialCode = "722724621";
const ownTargetCode = "722724622";
const opponentTargetCode = "722724623";
const exemptFusionCode = "722724624";
const removerCode = "722724625";
const albazCode = "68468459";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasQuaeritisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${quaeritisCode}.lua`));
const setDespia = 0x166;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const raceFiend = 0x8;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasQuaeritisScript)("Lua real script Despian Quaeritis main phase zero leave summon stat", () => {
  it("restores Fusion metadata, main-phase ATK zeroing, and opponent-effect leave-field Albaz summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${quaeritisCode}.lua`));
    const source = sourceWithRemover(workspace);
    const reader = createCardReader(cards());

    const restoredStat = createRestoredQuaeritisField({ reader, source: workspace, workspace, scenario: "stat" });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statQuaeritis = requireCard(restoredStat.session, quaeritisCode);
    const ownTarget = requireCard(restoredStat.session, ownTargetCode);
    const opponentTarget = requireCard(restoredStat.session, opponentTargetCode);
    const exemptFusion = requireCard(restoredStat.session, exemptFusionCode);
    expect(statQuaeritis.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setDespia }, { attribute: attributeLight | attributeDark }]);

    const zeroAll = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statQuaeritis.uid
    );
    expect(zeroAll, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    expect(zeroAll).toMatchObject({ effectId: "lua-2-1002", player: 0, uid: statQuaeritis.uid });
    applyRestoredActionAndAssert(restoredStat, zeroAll!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statQuaeritis.uid), restoredStat.session.state)).toBe(2500);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ownTarget.uid), restoredStat.session.state)).toBe(0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredStat.session.state)).toBe(0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === exemptFusion.uid), restoredStat.session.state)).toBe(3000);
    expect(restoredStat.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: 0x400, reset: { flags: 1107169792 }, sourceUid: ownTarget.uid, value: 0 },
      { code: effectSetAttackFinal, event: "continuous", property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponentTarget.uid, value: 0 },
    ]);

    const restoredLeave = createRestoredQuaeritisField({ reader, source, workspace, scenario: "leave" });
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 1);
    const leaveQuaeritis = requireCard(restoredLeave.session, quaeritisCode);
    const remover = requireCard(restoredLeave.session, removerCode);
    const albaz = requireCard(restoredLeave.session, albazCode);
    const removeQuaeritis = getLuaRestoreLegalActions(restoredLeave, 1).find((action) =>
      action.type === "activateEffect" && action.uid === remover.uid
    );
    expect(removeQuaeritis, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, removeQuaeritis!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.host.messages).toContain("quaeritis remover resolved");
    expect(restoredLeave.session.state.cards.find((card) => card.uid === leaveQuaeritis.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: remover.uid,
      reasonEffectId: 4,
    });
    expect(restoredLeave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1015",
        eventCardUid: leaveQuaeritis.uid,
        eventCode: 1015,
        eventName: "leftField",
        eventReason: duelReason.effect,
        eventReasonCardUid: remover.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: leaveQuaeritis.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredLeave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === leaveQuaeritis.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, trigger!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([
      { api: "SelectOption", player: 0, returned: 1 },
    ]);
    expect(restoredLeave.session.state.cards.find((card) => card.uid === albaz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: leaveQuaeritis.uid,
      reasonEffectId: 3,
    });
    expect(restoredLeave.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "leftField", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: leaveQuaeritis.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "extraDeck", current: "monsterZone", relatedEffectId: 4 },
      { eventCardUid: leaveQuaeritis.uid, eventCode: 1015, eventName: "leftField", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 4, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: leaveQuaeritis.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 4, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: remover.uid, eventCode: 1015, eventName: "leftField", eventPlayer: undefined, eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: remover.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: albaz.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: leaveQuaeritis.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: undefined },
    ]);
    expect(restoredLeave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredQuaeritisField({
  reader,
  source,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "stat" | "leave";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "stat" ? 72272462 : 72272463, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  const playerMain = scenario === "stat"
    ? [despiaMaterialCode, lightMaterialCode, ownTargetCode, exemptFusionCode, albazCode]
    : [albazCode];
  loadDecks(session, {
    0: { main: playerMain, extra: [quaeritisCode] },
    1: { main: [opponentTargetCode, removerCode] },
  });
  startDuel(session);
  const quaeritis = requireCard(session, quaeritisCode);
  moveFaceUpAttack(session, quaeritis, 0, 0);
  if (scenario === "stat") {
    moveFaceUpAttack(session, requireCard(session, ownTargetCode), 0, 1);
    moveFaceUpAttack(session, requireCard(session, exemptFusionCode), 0, 2);
    moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
  } else {
    moveDuelCard(session.state, requireCard(session, removerCode).uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
  }
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(quaeritisCode), source).ok).toBe(true);
  if (scenario === "leave") expect(host.loadCardScript(Number(removerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "leave" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
    promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }],
  });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Despian Quaeritis");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_DESPIA),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT|ATTRIBUTE_DARK))");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("return c:HasNonZeroAttack() and not (c:IsLevelAbove(8) and c:IsType(TYPE_FUSION))");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("return rp==1-tp and c:IsReason(REASON_EFFECT) and c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousControler(tp)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp,mzone_chk):GetFirst()");
  expect(script).toContain("aux.ToHandOrElse(sc,tp,");
  expect(script).toContain("Duel.SpecialSummon(sc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: quaeritisCode, name: "Despian Quaeritis", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 8, attack: 2500, defense: 2500 },
    { code: despiaMaterialCode, name: "Quaeritis Despia Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1200, setcodes: [setDespia] },
    { code: lightMaterialCode, name: "Quaeritis LIGHT Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: ownTargetCode, name: "Quaeritis Own Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: opponentTargetCode, name: "Quaeritis Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1900, defense: 1500 },
    { code: exemptFusionCode, name: "Quaeritis Exempt Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 8, attack: 3000, defense: 2500 },
    { code: removerCode, name: "Quaeritis Opponent Remover", kind: "spell", typeFlags: typeSpell },
    { code: albazCode, name: "Fallen of Albaz", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 0 },
  ];
}

function sourceWithRemover(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${removerCode}.lua`) return removerScript();
      return workspace.readScript(name);
    },
  };
}

function removerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOGRAVE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsCode(${quaeritisCode}) end
      if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${quaeritisCode}) end
      local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${quaeritisCode})
      Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,1-tp,0)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
      Debug.Message("quaeritis remover resolved")
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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
