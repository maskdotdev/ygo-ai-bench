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
const chimeraCode = "25586143";
const removeTargetCode = "255861430";
const battleTargetCode = "255861431";
const fusionSpellCode = "255861432";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChimeraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chimeraCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setFusion = 0x46;
const setPredaplant = 0x10f3;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasChimeraScript)("Lua real script Predaplant Chimerafflesia banish attack standby search stat", () => {
  it("restores target banish, attack-announced ATK swing, and delayed Standby Fusion Spell search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chimeraCode}.lua`);
    expectChimeraScriptShape(script);
    const reader = createCardReader(cards());

    const restoredRemove = createRestoredChimeraField({ reader, workspace, phase: "main1" });
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const removeChimera = requireCard(restoredRemove.session, chimeraCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find((action) => action.type === "activateEffect" && action.uid === removeChimera.uid && action.effectId === "lua-2");
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    resolveRestoredChain(restoredRemove);
    expect(restoredRemove.session.state.cards.find((card) => card.uid === removeChimera.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: removeChimera.uid,
      reasonEffectId: 2,
    });
    expect(restoredRemove.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: removeChimera.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "extraDeck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: removeChimera.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeChimera.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
    ]);

    const restoredBattle = createRestoredChimeraField({ reader, workspace, phase: "battle" });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleChimera = requireCard(restoredBattle.session, chimeraCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleChimera.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: battleChimera.uid,
        eventCode: 1130,
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventReason: 0,
        player: 0,
        sourceUid: battleChimera.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleChimera.uid);
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackBoost!);
    resolveRestoredChain(restoredAttackTrigger);

    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === battleChimera.uid), restoredAttackTrigger.session.state)).toBe(3500);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredAttackTrigger.session.state)).toBe(1000);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => [battleChimera.uid, battleTarget.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, sourceUid: battleTarget.uid, value: -1000 },
      { code: 100, reset: { flags: 1107169792 }, sourceUid: battleChimera.uid, value: 1000 },
    ]);

    const restoredToGrave = createRestoredChimeraField({ reader, workspace, phase: "main1" });
    expectCleanRestore(restoredToGrave);
    const graveChimera = requireCard(restoredToGrave.session, chimeraCode);
    const fusionSpell = requireCard(restoredToGrave.session, fusionSpellCode);
    sendDuelCardToGraveyard(restoredToGrave.session.state, graveChimera.uid, 0, duelReason.effect, 0);
    restoredToGrave.session.state.phase = "draw";
    restoredToGrave.session.state.waitingFor = 0;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredToGrave.session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-4098", eventCode: 0x1002, eventName: "phaseStandby", player: 0, sourceUid: graveChimera.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateTrigger" && action.uid === graveChimera.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === fusionSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveChimera.uid,
      reasonEffectId: 5,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${fusionSpellCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "phaseStandby", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveChimera.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "phaseStandby", eventCode: 0x1002, eventCardUid: undefined, eventPlayer: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: fusionSpell.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveChimera.uid, eventReasonEffectId: 5, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: fusionSpell.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveChimera.uid, eventReasonEffectId: 5, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: fusionSpell.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveChimera.uid, eventReasonEffectId: 5, previous: "deck", current: "hand" },
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredChimeraField({
  reader,
  workspace,
  phase,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  phase: DuelSession["state"]["phase"];
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 25586143, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [fusionSpellCode], extra: [chimeraCode] }, 1: { main: [removeTargetCode, battleTargetCode] } });
  startDuel(session);
  const chimera = requireCard(session, chimeraCode);
  moveFaceUpAttack(session, chimera, 0, 0);
  chimera.summonType = "fusion";
  moveFaceUpAttack(session, requireCard(session, removeTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 1);
  session.state.phase = phase;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(chimeraCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectChimeraScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PREDAPLANT),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK))");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelBelow(lv) and c:IsAbleToRemove()");
  expect(script).toContain("Duel.SelectTarget(tp,s.rmfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,c:GetLevel())");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e:SetLabelObject(tc)");
  expect(script).toContain("e:GetLabelObject():CreateEffectRelation(e)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("not tc:IsHasEffect(EFFECT_REVERSE_UPDATE)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(1000)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY");
  expect(script).toContain("Duel.GetTurnCount()");
  expect(script).toContain("e4:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return tid and tid~=Duel.GetTurnCount()");
  expect(script).toContain("return c:IsSetCard(SET_FUSION) and c:IsSpell() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: chimeraCode, name: "Predaplant Chimerafflesia", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, setcodes: [setPredaplant], race: racePlant, attribute: attributeDark, level: 7, attack: 2500, defense: 2000 },
    { code: removeTargetCode, name: "Chimerafflesia Lower-Level Remove Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: battleTargetCode, name: "Chimerafflesia Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
    { code: fusionSpellCode, name: "Chimerafflesia Fusion Spell Search Target", kind: "spell", typeFlags: typeSpell, setcodes: [setFusion] },
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
