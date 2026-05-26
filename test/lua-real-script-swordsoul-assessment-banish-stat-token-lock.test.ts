import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const assessmentCode = "78836195";
const targetCode = "788361950";
const wyrmCode = "788361951";
const tokenCode = "20001444";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAssessmentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${assessmentCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeToken = 0x4000;
const setSwordsoul = 0x16d;
const raceWarrior = 0x1;
const raceWyrm = 0x800000;
const attributeWater = 0x2;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectCannotSpecialSummon = 22;
const effectClockLizard = 51476410;

describe.skipIf(!hasUpstreamScripts || !hasAssessmentScript)("Lua real script Swordsoul Assessment banish stat token lock", () => {
  it("restores activation banish ATK gain and banished-trigger Swordsoul Token summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${assessmentCode}.lua`);
    expectAssessmentScriptShape(script);
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredAssessmentField({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const assessment = requireCard(restoredActivation.session, assessmentCode);
    const target = requireCard(restoredActivation.session, targetCode);
    const wyrm = requireCard(restoredActivation.session, wyrmCode);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === assessment.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === wyrm.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: assessment.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === target.uid), restoredActivation.session.state)).toBe(2100);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: target.uid, value: 300 },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: wyrm.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: assessment.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
    ]);

    const restoredBanish = createRestoredAssessmentField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    const banishedAssessment = requireCard(restoredBanish.session, assessmentCode);
    banishDuelCard(restoredBanish.session.state, banishedAssessment.uid, 0, duelReason.effect, 0);
    expect(restoredBanish.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1011", eventCardUid: banishedAssessment.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, player: 0, sourceUid: banishedAssessment.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === banishedAssessment.uid && action.effectId === "lua-2-1011");
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, tokenSummon!);
    resolveRestoredChain(restoredTrigger);
    const token = restoredTrigger.session.state.cards.find((card) => card.code === tokenCode);
    expect(token).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: banishedAssessment.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === token!.uid && [effectCannotSpecialSummon, effectClockLizard].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotSpecialSummon, property: 0x800, range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: token!.uid, targetRange: [1, 0], value: undefined },
      { code: effectClockLizard, property: undefined, range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: token!.uid, targetRange: [255, 0], value: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: banishedAssessment.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: token!.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: banishedAssessment.uid, eventReasonEffectId: 2, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAssessmentField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78836195, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [assessmentCode, targetCode, wyrmCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  const assessment = moveDuelCard(session.state, requireCard(session, assessmentCode).uid, "spellTrapZone", 0);
  assessment.sequence = 0;
  assessment.faceUp = false;
  assessment.position = "faceDown";
  const wyrm = moveDuelCard(session.state, requireCard(session, wyrmCode).uid, "graveyard", 0);
  wyrm.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(assessmentCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAssessmentScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return (c:IsSetCard(SET_SWORDSOUL) or (c:IsMonster() and c:IsRace(RACE_WYRM)))");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil,g)");
  expect(script).toContain("local sg=g:Select(tp,1,5,tc)");
  expect(script).toContain("local rc=Duel.Remove(sg,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300*rc)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_SWORDSOUL,SET_SWORDSOUL,TYPES_TOKEN|TYPE_TUNER,0,0,4,RACE_WYRM,ATTRIBUTE_WATER)");
  expect(script).toContain("local token=Duel.CreateToken(tp,TOKEN_SWORDSOUL)");
  expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("not c:IsType(TYPE_SYNCHRO)");
  expect(script).toContain("aux.createContinuousLizardCheck(c,LOCATION_MZONE,function(_,c) return not c:IsOriginalType(TYPE_SYNCHRO) end)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: assessmentCode, name: "Swordsoul Assessment", kind: "trap", typeFlags: typeTrap },
    { code: targetCode, name: "Assessment ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: wyrmCode, name: "Assessment Swordsoul Wyrm", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSwordsoul], race: raceWyrm, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
    { code: tokenCode, name: "Swordsoul Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeTuner | typeToken, setcodes: [setSwordsoul], race: raceWyrm, attribute: attributeWater, level: 4, attack: 0, defense: 0 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
