import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, drawDuelCards, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dasherCode = "81866673";
const releaseCostCode = "818666730";
const defenderCode = "818666731";
const drawnMonsterCode = "818666732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDasherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dasherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const eventDraw = 1110;
const eventPhaseBattle = 0x1080;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDasherScript)("Lua real script Destiny HERO Dasher release stat draw position", () => {
  it("restores release-cost ATK gain, Battle Phase defense change, and grave draw Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dasherCode}.lua`));
    const databaseDasher = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dasherCode);
    expect(databaseDasher).toBeDefined();
    const reader = createCardReader([
      databaseDasher!,
      ...cards(),
    ]);

    const restoredField = createRestoredFieldWindow({ reader, workspace });
    expectCleanRestore(restoredField);
    expectRestoredLegalActions(restoredField, 0);
    const fieldDasher = requireCard(restoredField.session, dasherCode);
    const releaseCost = requireCard(restoredField.session, releaseCostCode);
    const defender = requireCard(restoredField.session, defenderCode);
    const boost = getLuaRestoreLegalActions(restoredField, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldDasher.uid && action.effectId === "lua-1"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, boost!);
    resolveRestoredChain(restoredField);

    expect(restoredField.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: fieldDasher.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === fieldDasher.uid), restoredField.session.state)).toBe(3100);
    expect(restoredField.session.state.effects.filter((effect) => effect.sourceUid === fieldDasher.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, registryKey: `lua:${dasherCode}:lua-4-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: fieldDasher.uid, value: 1000 },
    ]);

    const battle = getLuaRestoreLegalActions(restoredField, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, battle!);
    const attack = getLuaRestoreLegalActions(restoredField, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === fieldDasher.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, attack!);
    passBattleResponses(restoredField);
    const main2 = getLuaRestoreLegalActions(restoredField, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, main2!);

    expect(restoredField.session.state.cards.find((card) => card.uid === fieldDasher.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(restoredField.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fieldDasher.uid,
    });
    expect(restoredField.session.state.eventHistory.filter((event) => ["attackDeclared", "phaseBattle", "positionChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.position,
      current: event.eventCurrentState?.position,
    }))).toEqual([
      { eventName: "phaseBattle", eventCode: 4104, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: fieldDasher.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "faceDown", current: "faceUpAttack" },
      { eventName: "phaseBattle", eventCode: 4224, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "positionChanged", eventCode: 1016, eventCardUid: fieldDasher.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fieldDasher.uid, eventReasonEffectId: 2, previous: "faceUpAttack", current: "faceUpDefense" },
    ]);

    const restoredDraw = createRestoredDrawWindow({ reader, workspace });
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const graveDasher = requireCard(restoredDraw.session, dasherCode);
    const drawnMonster = requireCard(restoredDraw.session, drawnMonsterCode);
    expect(restoredDraw.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      eventUids: trigger.eventUids,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1110",
        eventCardUid: drawnMonster.uid,
        eventCode: eventDraw,
        eventName: "cardsDrawn",
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [drawnMonster.uid],
        eventValue: 1,
        player: 0,
        sourceUid: graveDasher.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const drawTrigger = getLuaRestoreLegalActions(restoredDraw, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveDasher.uid && action.effectId === "lua-3-1110"
    );
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, drawTrigger!);
    resolveRestoredChain(restoredDraw);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === drawnMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveDasher.uid,
      reasonEffectId: 3,
    });
    expect(restoredDraw.session.state.eventHistory.filter((event) => ["cardsDrawn", "confirmed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "cardsDrawn", eventCode: eventDraw, eventCardUid: drawnMonster.uid, eventPlayer: 0, eventValue: 1, eventUids: [drawnMonster.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: drawnMonster.uid, eventPlayer: 1, eventValue: 1, eventUids: [drawnMonster.uid], eventReason: 1024, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: drawnMonster.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [drawnMonster.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: graveDasher.uid, eventReasonEffectId: 3, previous: "hand", current: "monsterZone" },
    ]);
    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredFieldWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 81866673, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dasherCode, releaseCostCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dasherCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, releaseCostCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dasherCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDrawWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 81866674, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dasherCode, drawnMonsterCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, dasherCode).uid, "graveyard", 0);
  session.state.phase = "draw";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dasherCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(drawDuelCards(session.state, 0, 1, "Destiny HERO - Dasher fixture draw", { eventReason: duelReason.effect, eventReasonPlayer: 0 })).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Destiny HERO - Dasher");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,c)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,c)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("return e:GetHandler():GetAttackedCount()>0");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_NO_TURN_RESET)");
  expect(script).toContain("e3:SetCode(EVENT_DRAW)");
  expect(script).toContain("Duel.IsPhase(PHASE_DRAW) and Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,eg)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: releaseCostCode, name: "Dasher Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Dasher Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: drawnMonsterCode, name: "Dasher Drawn Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
