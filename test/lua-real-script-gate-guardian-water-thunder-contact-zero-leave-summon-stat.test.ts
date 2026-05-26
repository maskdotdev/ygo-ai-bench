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
const gateCode = "97783338";
const suijinCode = "98434877";
const sangaCode = "25955164";
const targetCode = "977833380";
const removerCode = "977833381";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGateScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gateCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceAqua = 0x40;
const raceThunder = 0x2000;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasGateScript)("Lua real script Gate Guardian of Water and Thunder contact zero leave summon stat", () => {
  it("restores contact metadata, opponent ATK zeroing, and opponent-effect leave-field banished-piece summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gateCode}.lua`));
    const source = sourceWithRemover(workspace);
    const reader = createCardReader(cards());

    const restoredStat = createRestoredGateField({ reader, source: workspace, workspace, scenario: "stat" });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statGate = requireCard(restoredStat.session, gateCode);
    const target = requireCard(restoredStat.session, targetCode);

    const zeroTarget = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statGate.uid
    );
    expect(zeroTarget, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, zeroTarget!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(0);
    expect(restoredStat.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 0 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);

    const restoredLeave = createRestoredGateField({ reader, source, workspace, scenario: "leave" });
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 1);
    const leaveGate = requireCard(restoredLeave.session, gateCode);
    const remover = requireCard(restoredLeave.session, removerCode);
    const suijin = requireCard(restoredLeave.session, suijinCode);
    const removeGate = getLuaRestoreLegalActions(restoredLeave, 1).find((action) =>
      action.type === "activateEffect" && action.uid === remover.uid
    );
    expect(removeGate, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, removeGate!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.host.messages).toContain("gate guardian water thunder remover resolved");
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
        effectId: "lua-4-1015",
        eventCardUid: leaveGate.uid,
        eventCode: 1015,
        eventName: "leftField",
        eventReason: duelReason.effect,
        eventReasonCardUid: remover.uid,
        eventReasonEffectId: 5,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: leaveGate.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredLeave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === leaveGate.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, trigger!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.cards.find((card) => card.uid === suijin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: leaveGate.uid,
      reasonEffectId: 4,
    });
    expect(restoredLeave.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "leftField", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: leaveGate.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "extraDeck", current: "monsterZone", relatedEffectId: 5 },
      { eventCardUid: leaveGate.uid, eventCode: 1015, eventName: "leftField", eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 5, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: leaveGate.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: remover.uid, eventReasonEffectId: 5, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: remover.uid, eventCode: 1015, eventName: "leftField", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: remover.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: suijin.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: leaveGate.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "banished", current: "monsterZone", relatedEffectId: undefined },
    ]);
    expect(restoredLeave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredGateField({
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
  const session = createDuel({ seed: scenario === "stat" ? 97783338 : 97783339, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [suijinCode, sangaCode], extra: [gateCode] },
    1: { main: [targetCode, removerCode] },
  });
  startDuel(session);
  const gate = requireCard(session, gateCode);
  moveFaceUpAttack(session, gate, 0, 0);
  gate.summonType = "special";
  if (scenario === "stat") {
    moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
  } else {
    moveDuelCard(session.state, requireCard(session, removerCode).uid, "hand", 1);
    const suijin = moveDuelCard(session.state, requireCard(session, suijinCode).uid, "banished", 0);
    suijin.faceUp = true;
    suijin.position = "faceUpAttack";
    const sanga = moveDuelCard(session.state, requireCard(session, sangaCode).uid, "banished", 0);
    sanga.faceUp = true;
    sanga.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
  }
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gateCode), source).ok).toBe(true);
  if (scenario === "leave") expect(host.loadCardScript(Number(removerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "leave" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gate Guardian of Water and Thunder");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,CARD_SUIJIN,CARD_SANGA_OF_THE_THUNDER)");
  expect(script).toContain("Fusion.AddContactProc(c,s.contactfil,s.contactop,true)");
  expect(script).toContain("return Duel.GetMatchingGroup(Card.IsAbleToRemoveAsCost,tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST|REASON_MATERIAL)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("return c:IsPreviousPosition(POS_FACEUP) and c:IsSpecialSummoned() and c:IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("return c:IsCode(CARD_SUIJIN,CARD_SANGA_OF_THE_THUNDER) and c:IsFaceup() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: gateCode, name: "Gate Guardian of Water and Thunder", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceThunder, level: 9, attack: 2550, defense: 2300 },
    { code: suijinCode, name: "Suijin", kind: "monster", typeFlags: typeMonster, race: raceAqua, level: 7, attack: 2500, defense: 2400 },
    { code: sangaCode, name: "Sanga of the Thunder", kind: "monster", typeFlags: typeMonster, race: raceThunder, level: 7, attack: 2600, defense: 2200 },
    { code: targetCode, name: "Gate Guardian Water Thunder Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, level: 4, attack: 1900, defense: 1200 },
    { code: removerCode, name: "Gate Guardian Water Thunder Remover", kind: "spell", typeFlags: typeSpell },
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
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsCode(${gateCode}) end
      if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${gateCode}) end
      local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${gateCode})
      Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,1-tp,0)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
      Debug.Message("gate guardian water thunder remover resolved")
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
