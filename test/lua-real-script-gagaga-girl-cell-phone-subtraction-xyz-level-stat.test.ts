import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cellPhoneCode = "48393693";
const allyCode = "483936930";
const targetXyzCode = "483936931";
const opponentExtraCode = "483936932";
const opponentTargetCode = "483936933";
const drumCode = "77799846";
const detachMaterialCode = "483936934";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCellPhoneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cellPhoneCode}.lua`));
const hasDrumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drumCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const raceMachine = 0x20;
const attributeDark = 0x20;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const eventSpecialSummonSuccess = 1102;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasCellPhoneScript || !hasDrumScript)("Lua real script Gagaga Girl Cell Phone Subtraction xyz level stat", () => {
  it("restores opponent Extra Deck summon trigger into Level-treated hand summon Xyz Summon and detached ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${cellPhoneCode}.lua`));
    const reader = createCardReader(cards());

    const liveTriggerSession = createXyzField({ reader, workspace });
    const cellPhone = requireCard(liveTriggerSession, cellPhoneCode);
    const opponentExtra = requireCard(liveTriggerSession, opponentExtraCode);
    specialSummonDuelCard(liveTriggerSession.state, opponentExtra.uid, 1, 1, {}, luaSummonTypeXyz, true, true);
    expect(liveTriggerSession.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1102", eventCardUid: opponentExtra.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", player: 0, sourceUid: cellPhone.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(liveTriggerSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cellPhone.uid && action.effectId === "lua-1-1102");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const ally = requireCard(restoredTrigger.session, allyCode);
    const targetXyz = requireCard(restoredTrigger.session, targetXyzCode);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === targetXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "xyz",
      overlayUids: [cellPhone.uid, ally.uid],
      reason: duelReason.summon | duelReason.specialSummon | duelReason.xyz,
      reasonPlayer: 0,
      reasonCardUid: cellPhone.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === cellPhone.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.material | duelReason.xyz,
      reasonPlayer: 0,
      reasonCardUid: cellPhone.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "usedAsMaterial"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: opponentExtra.uid, eventUids: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ally.uid, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: cellPhone.uid, eventUids: [cellPhone.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: cellPhone.uid, eventReasonEffectId: 1 },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: cellPhone.uid, eventUids: undefined, eventReason: duelReason.material | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: cellPhone.uid, eventReasonEffectId: 1 },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: ally.uid, eventUids: undefined, eventReason: duelReason.material | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: cellPhone.uid, eventReasonEffectId: 1 },
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: targetXyz.uid, eventUids: undefined, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: cellPhone.uid, eventReasonEffectId: 1 },
    ]);

    const restoredDetach = createRestoredDetachField({ reader, workspace });
    expectCleanRestore(restoredDetach);
    expectRestoredLegalActions(restoredDetach, 0);
    const drum = requireCard(restoredDetach.session, drumCode);
    const detachCellPhone = requireCard(restoredDetach.session, cellPhoneCode);
    const opponentTarget = requireCard(restoredDetach.session, opponentTargetCode);
    const detach = getLuaRestoreLegalActions(restoredDetach, 0).find((action) => action.type === "activateEffect" && action.uid === drum.uid && action.effectId === "lua-5");
    expect(detach, JSON.stringify(getLuaRestoreLegalActions(restoredDetach, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDetach, detach!);
    resolveRestoredChain(restoredDetach);

    expect(restoredDetach.session.state.cards.find((card) => card.uid === detachCellPhone.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: drum.uid,
      reasonEffectId: 5,
      previousLocation: "overlay",
    });
    const restoredAtkTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDetach.session), workspace, reader);
    expectCleanRestore(restoredAtkTrigger);
    expectRestoredLegalActions(restoredAtkTrigger, 0);
    const atkZero = getLuaRestoreLegalActions(restoredAtkTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === detachCellPhone.uid && action.effectId === "lua-2-1014");
    expect(atkZero, JSON.stringify(getLuaRestoreLegalActions(restoredAtkTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAtkTrigger, atkZero!);
    resolveRestoredChain(restoredAtkTrigger);

    expect(currentAttack(restoredAtkTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredAtkTrigger.session.state)).toBe(0);
    expect(restoredAtkTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: opponentTarget.uid, value: 0 },
    ]);
    expect(restoredAtkTrigger.session.state.eventHistory.filter((event) => ["detachedMaterial", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: eventToGrave, eventCardUid: detachCellPhone.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: drum.uid, eventReasonEffectId: 5 },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: detachCellPhone.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: drum.uid, eventReasonEffectId: 5 },
    ]);
    expect(restoredAtkTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gagaga Girl - Cell Phone Subtraction");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_XYZ_LEVEL)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonCount(tp,2)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil,tp,c)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsXyzSummonable,tp,LOCATION_EXTRA,0,1,1,nil,nil,mg,2,2)");
  expect(script).toContain("Duel.XyzSummon(tp,xyz,mg,nil,2,2)");
  expect(script).toContain("e2a:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e2b:SetCode(EVENT_REMOVE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
}

function cards(): DuelCardData[] {
  return [
    { code: cellPhoneCode, name: "Gagaga Girl - Cell Phone Subtraction", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 1, attack: 0, defense: 0 },
    { code: allyCode, name: "Cell Phone Level 4 Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: targetXyzCode, name: "Cell Phone Rank 4 Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 2400, defense: 2000, xyzMaterialCount: 2, xyzMaterialMax: 2 },
    { code: opponentExtraCode, name: "Opponent Extra Deck Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2100, defense: 1800 },
    { code: opponentTargetCode, name: "Cell Phone Opponent ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
    { code: drumCode, name: "Googly-Eyes Drum Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 8, attack: 3000, defense: 2500 },
    { code: detachMaterialCode, name: "Cell Phone Extra Xyz Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 1000, defense: 1000 },
  ];
}

function createXyzField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 48393693, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cellPhoneCode, allyCode], extra: [targetXyzCode] }, 1: { main: [], extra: [opponentExtraCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, cellPhoneCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace, [cellPhoneCode]);
  return session;
}

function createRestoredDetachField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 48393694, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cellPhoneCode, detachMaterialCode], extra: [drumCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  const drum = requireCard(session, drumCode);
  moveFaceUpAttack(session, drum, 0, 0);
  drum.summonType = "xyz";
  drum.customStatusMask = 0x8;
  attachOverlay(session, drum, requireCard(session, cellPhoneCode), 0);
  attachOverlay(session, drum, requireCard(session, detachMaterialCode), 1);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace, [cellPhoneCode, drumCode]);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, codes: string[]): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of codes) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(codes.length);
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

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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
