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
const chanbaraCode = "42110604";
const firstTargetCode = "421106040";
const secondTargetCode = "421106041";
const banishedSpeedroidCode = "421106042";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasChanbaraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chanbaraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x80;
const attributeWind = 0x20;
const setSpeedroid = 0x2016;
const eventBattleStart = 1132;
const effectUpdateAttack = 100;
const effectExtraAttack = 194;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasChanbaraScript)("Lua real script Hi-Speedroid Chanbara extra battle stat to hand", () => {
  it("restores static extra attack, mandatory battle-start ATK gain, and delayed Speedroid banished recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${chanbaraCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const chanbara = requireCard(restoredOpen.session, chanbaraCode);
    const firstTarget = requireCard(restoredOpen.session, firstTargetCode);
    const secondTarget = requireCard(restoredOpen.session, secondTargetCode);
    const banishedSpeedroid = requireCard(restoredOpen.session, banishedSpeedroidCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === chanbara.uid && effect.code === effectExtraAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttack, event: "continuous", range: ["monsterZone"], sourceUid: chanbara.uid, value: 1 },
    ]);

    const firstAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === chanbara.uid && action.targetUid === firstTarget.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, firstAttack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1132", eventCardUid: chanbara.uid, eventCode: eventBattleStart, eventName: "battleStarted", eventTriggerTiming: "when", player: 0, sourceUid: chanbara.uid, triggerBucket: "turnMandatory" },
    ]);
    const restoredBattleStart = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattleStart);
    expectRestoredLegalActions(restoredBattleStart, 0);
    const battleStart = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chanbara.uid && action.effectId === "lua-4-1132"
    );
    expect(battleStart, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleStart, battleStart!);
    resolveRestoredChain(restoredBattleStart);
    expect(currentAttack(restoredBattleStart.session.state.cards.find((card) => card.uid === chanbara.uid), restoredBattleStart.session.state)).toBe(2200);
    expect(restoredBattleStart.session.state.effects.filter((effect) => effect.sourceUid === chanbara.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: chanbara.uid, value: 200 },
    ]);

    finishBattle(restoredBattleStart);
    expect(restoredBattleStart.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
    });
    const restoredSecond = restoreDuelWithLuaScripts(serializeDuel(restoredBattleStart.session), workspace, reader);
    expectCleanRestore(restoredSecond);
    expectRestoredLegalActions(restoredSecond, 0);
    const secondActions = getLuaRestoreLegalActions(restoredSecond, 0);
    expect(secondActions.some((action) => action.type === "declareAttack" && action.attackerUid === chanbara.uid && action.targetUid === secondTarget.uid)).toBe(true);
    expect(secondActions.some((action) => action.type === "declareAttack" && action.attackerUid === chanbara.uid && action.directAttack === true)).toBe(false);

    sendDuelCardToGraveyard(restoredSecond.session.state, chanbara.uid, 0, duelReason.effect, 0);
    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredSecond.session), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    expect(restoredGrave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1014", eventCardUid: chanbara.uid, eventCode: 1014, eventName: "sentToGraveyard", player: 0, sourceUid: chanbara.uid, triggerBucket: "turnOptional" },
    ]);
    const recover = getLuaRestoreLegalActions(restoredGrave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chanbara.uid && action.effectId === "lua-5-1014"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, recover!);
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === banishedSpeedroid.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chanbara.uid,
      reasonEffectId: 5,
    });
    expect(restoredGrave.session.state.eventHistory.filter((event) =>
      ["battleStarted", "sentToGraveyard", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: chanbara.uid, eventCode: eventBattleStart, eventName: "battleStarted", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: firstTarget.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: chanbara.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: chanbara.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: banishedSpeedroid.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 5 },
      { eventCardUid: banishedSpeedroid.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: chanbara.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42110604, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [banishedSpeedroidCode], extra: [chanbaraCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, chanbaraCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, firstTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, secondTargetCode), 1, 1);
  moveFaceUpBanished(session, requireCard(session, banishedSpeedroidCode), 0, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(chanbaraCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const chanbara = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chanbaraCode);
  expect(chanbara).toBeDefined();
  return [
    chanbara!,
    { code: firstTargetCode, name: "Chanbara First Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: secondTargetCode, name: "Chanbara Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: banishedSpeedroidCode, name: "Chanbara Banished Speedroid", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 3, attack: 1200, defense: 1000, setcodes: [setSpeedroid] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Hi-Speedroid Chanbara");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("return e:GetHandler():IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_SPEEDROID) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_REMOVED,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
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

function moveFaceUpBanished(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "banished", player);
  moved.faceUp = true;
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
