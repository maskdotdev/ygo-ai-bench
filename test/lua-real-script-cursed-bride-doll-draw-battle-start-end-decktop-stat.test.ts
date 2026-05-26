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
const brideCode = "71545247";
const ownDeckCodeA = "715452470";
const ownDeckCodeB = "715452471";
const ownDeckCodeC = "715452472";
const ownDeckCodeD = "715452473";
const opponentDeckCode = "715452474";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBrideScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${brideCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBrideScript)("Lua real script Cursed Bride Doll draw battle-start End Phase decktop stat", () => {
  it("restores draw self-Special Summon, deck-count Battle Start ATK gain, and same-turn graveyard Deck top return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${brideCode}.lua`);
    expectScriptShape(script);
    const brideData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === brideCode);
    expect(brideData).toBeDefined();
    const reader = createCardReader(cards(brideData!));

    const restoredDraw = createRestoredDrawWindow({ reader, workspace });
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const drawnBride = requireCard(restoredDraw.session, brideCode);
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
        effectId: "lua-1-1110",
        eventCardUid: drawnBride.uid,
        eventCode: 1110,
        eventName: "cardsDrawn",
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [drawnBride.uid],
        eventValue: 1,
        player: 0,
        sourceUid: drawnBride.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const drawTrigger = getLuaRestoreLegalActions(restoredDraw, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === drawnBride.uid && action.effectId === "lua-1-1110"
    );
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, drawTrigger!);
    expect(restoredDraw.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDraw);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === drawnBride.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: drawnBride.uid,
      reasonEffectId: 1,
    });
    expect(restoredDraw.session.state.eventHistory.filter((event) => ["cardsDrawn", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "cardsDrawn", eventCode: 1110, eventCardUid: drawnBride.uid, eventPlayer: 0, eventValue: 1, eventUids: [drawnBride.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: drawnBride.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [drawnBride.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: drawnBride.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleBride = requireCard(restoredBattle.session, brideCode);
    const battle = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battle!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-4104", eventCode: 4104, eventName: "phaseBattle", player: 0, sourceUid: battleBride.uid, triggerBucket: "turnMandatory" },
    ]);
    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleBride.uid && action.effectId === "lua-2-4104"
    );
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleBride.uid), restoredBattleTrigger.session.state)).toBe((brideData!.attack ?? 0) + 900);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleBride.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: battleBride.uid, value: 900 },
    ]);
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "phaseBattle", eventCode: 4104, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredEnd = createRestoredEndWindow({ reader, workspace });
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const graveBride = requireCard(restoredEnd.session, brideCode);
    const end = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, end!);
    expect(restoredEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-4608", eventCode: 4608, eventName: "phaseEnd", player: 0, sourceUid: graveBride.uid, triggerBucket: "turnMandatory" },
    ]);
    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    const endTrigger = getLuaRestoreLegalActions(restoredEndTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveBride.uid && action.effectId === "lua-3-4608"
    );
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndTrigger, endTrigger!);
    expect(restoredEndTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredEndTrigger);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === graveBride.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveBride.uid,
      reasonEffectId: 3,
    });
    expect(restoredEndTrigger.session.state.eventHistory.filter((event) => ["phaseEnd", "sentToDeck"].includes(event.eventName)).map((event) => ({
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
      { eventName: "phaseEnd", eventCode: 4608, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: graveBride.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBride.uid, eventReasonEffectId: 3, previous: "graveyard", current: "deck" },
    ]);
    expect(restoredEndTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDrawWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71545247, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [brideCode, ownDeckCodeA] }, 1: { main: [] } });
  startDuel(session);
  const bride = requireCard(session, brideCode);
  for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "deck")) {
    card.sequence = card.uid === bride.uid ? 0 : 1;
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(brideCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(drawDuelCards(session.state, 0, 1, "Cursed Bride Doll fixture draw", { eventReason: duelReason.effect, eventReasonPlayer: 0 })).toBe(1);
  expect(session.state.cards.find((card) => card.uid === bride.uid)).toMatchObject({ location: "hand", faceUp: false });
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71545248, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [brideCode, ownDeckCodeA, ownDeckCodeB, ownDeckCodeC, ownDeckCodeD] }, 1: { main: [opponentDeckCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, brideCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(brideCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredEndWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71545249, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [brideCode, ownDeckCodeA, ownDeckCodeB] }, 1: { main: [] } });
  startDuel(session);
  const graveBride = moveDuelCard(session.state, requireCard(session, brideCode).uid, "graveyard", 0);
  graveBride.turnId = session.state.turn;
  session.state.phase = "main2";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(brideCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Cursed Bride Doll");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_DRAW)");
  expect(script).toContain("not e:GetHandler():IsPublic()");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)-Duel.GetFieldGroupCount(tp,0,LOCATION_DECK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e:GetHandler():GetTurnID()==Duel.GetTurnCount()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKTOP,REASON_EFFECT)");
}

function cards(brideData: DuelCardData): DuelCardData[] {
  return [
    brideData,
    { code: ownDeckCodeA, name: "Cursed Bride Doll Own Deck Fixture A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    { code: ownDeckCodeB, name: "Cursed Bride Doll Own Deck Fixture B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
    { code: ownDeckCodeC, name: "Cursed Bride Doll Own Deck Fixture C", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1000 },
    { code: ownDeckCodeD, name: "Cursed Bride Doll Own Deck Fixture D", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    { code: opponentDeckCode, name: "Cursed Bride Doll Opponent Deck Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
