import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const heartCode = "97403510";
const materialCode = "974035100";
const opponentCode = "974035101";
const banishedCode = "974035102";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHeartScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heartCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectIndestructableBattle = 42;
const effectUpdateAttack = 100;
const effectReflectBattleDamage = 202;

describe.skipIf(!hasUpstreamScripts || !hasHeartScript)("Lua real script Number 92 end banish revive stat", () => {
  it("restores static battle effects, opponent End Phase banish, and destroyed revive ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${heartCode}.lua`);
    expectHeartScriptShape(script);
    const reader = createCardReader(cards());

    const restoredEnd = createRestoredHeartField({ reader, workspace, opponentTurn: true });
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 1);
    const endHeart = requireCard(restoredEnd.session, heartCode);
    const material = requireCard(restoredEnd.session, materialCode);
    const opponent = requireCard(restoredEnd.session, opponentCode);
    expect(restoredEnd.session.state.effects.filter((effect) => effect.sourceUid === endHeart.uid && [effectReflectBattleDamage, effectIndestructableBattle].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectReflectBattleDamage, sourceUid: endHeart.uid, value: 1 },
      { code: effectIndestructableBattle, sourceUid: endHeart.uid, value: 1 },
    ]);
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 1).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-4608", eventCode: 0x1200, eventName: "phaseEnd", player: 0, sourceUid: endHeart.uid, triggerBucket: "opponentOptional" },
    ]);
    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    const banish = getLuaRestoreLegalActions(restoredEndTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === endHeart.uid && action.effectId === "lua-4-4608");
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndTrigger, banish!);
    resolveRestoredChain(restoredEndTrigger);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === endHeart.uid)?.overlayUids).toEqual([]);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", reason: duelReason.cost, reasonPlayer: 0 });
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: endHeart.uid,
      reasonEffectId: 4,
    });

    const restoredDestroyed = createRestoredHeartField({ reader, workspace, opponentTurn: false });
    expectCleanRestore(restoredDestroyed);
    const reviveHeart = requireCard(restoredDestroyed.session, heartCode);
    moveDuelCard(restoredDestroyed.session.state, requireCard(restoredDestroyed.session, banishedCode).uid, "banished", 0).faceUp = true;
    sendDuelCardToGraveyard(restoredDestroyed.session.state, reviveHeart.uid, 0, duelReason.destroy | duelReason.effect, 1);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1014", eventCardUid: reviveHeart.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.destroy | duelReason.effect, player: 0, sourceUid: reviveHeart.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateTrigger" && action.uid === reviveHeart.uid && action.effectId === "lua-5-1014");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    resolveRestoredChain(restoredRevive);

    const restoredAtk = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), workspace, reader);
    expectCleanRestore(restoredAtk);
    expectRestoredLegalActions(restoredAtk, 0);
    const atk = getLuaRestoreLegalActions(restoredAtk, 0).find((action) => action.type === "activateTrigger" && action.uid === reviveHeart.uid && action.effectId === "lua-6-1102");
    expect(atk, JSON.stringify(getLuaRestoreLegalActions(restoredAtk, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAtk, atk!);
    resolveRestoredChain(restoredAtk);
    expect(restoredAtk.session.state.cards.find((card) => card.uid === reviveHeart.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviveHeart.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredAtk.session.state.cards.find((card) => card.uid === reviveHeart.uid), restoredAtk.session.state)).toBe(1000);
    expect(restoredAtk.session.state.effects.filter((effect) => effect.sourceUid === reviveHeart.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: reviveHeart.uid, value: 1000 },
    ]);
    expect(restoredAtk.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: reviveHeart.uid, eventReason: duelReason.destroy | duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveHeart.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: reviveHeart.uid, eventReasonEffectId: 5, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredAtk.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredHeartField({
  reader,
  workspace,
  opponentTurn,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  opponentTurn: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 97403510, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, banishedCode], extra: [heartCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const heart = requireCard(session, heartCode);
  moveFaceUpAttack(session, heart, 0, 0);
  heart.summonType = "xyz";
  heart.customStatusMask = 0x8;
  const material = moveDuelCard(session.state, requireCard(session, materialCode).uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  heart.overlayUids.push(material.uid);
  const opponent = moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  opponent.turnId = session.state.turn;
  session.state.phase = "main2";
  session.state.turnPlayer = opponentTurn ? 1 : 0;
  session.state.waitingFor = opponentTurn ? 1 : 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(heartCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectHeartScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,9,3)");
  expect(script).toContain("e1:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("return (c:IsLocation(LOCATION_MZONE) or c:GetFlagEffect(id)~=0) and c:GetTurnID()==turn and c:IsAbleToRemove()");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e4:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsReason(REASON_DESTROY) and e:GetHandler():GetOverlayCount()>0");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e5:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e5:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e5:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_REMOVED,LOCATION_REMOVED)*1000");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("ge1:SetCode(EVENT_SSET)");
}

function cards(): DuelCardData[] {
  return [
    { code: heartCode, name: "Number 92: Heart-eartH Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 9, attack: 0, defense: 0, xyzMaterialCount: 3, xyzMaterialRank: 9 },
    { code: materialCode, name: "Heart-eartH Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 9, attack: 1000, defense: 1000 },
    { code: opponentCode, name: "Heart-eartH Opponent Turn Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: banishedCode, name: "Heart-eartH Banished Counter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
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
