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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const blueFlameCode = "50903514";
const warriorCode = "509035140";
const reviveCode = "509035141";
const defenderCode = "509035142";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blue Flame Swordsman attack transfer revive", () => {
  it("restores Damage Step ATK transfer and destroyed-to-Grave self-banish FIRE Warrior revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blueFlameCode}.lua`);
    expectScriptShape(script);
    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const blueFlameData = databaseCards.find((card) => card.code === blueFlameCode);
    expect(blueFlameData).toBeDefined();
    const reader = createCardReader([
      blueFlameData!,
      { code: warriorCode, name: "Blue Flame Swordsman Warrior Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1500, defense: 1200 },
      { code: reviveCode, name: "Blue Flame Swordsman FIRE Warrior Revive", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
      { code: defenderCode, name: "Blue Flame Swordsman Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
    ] satisfies DuelCardData[]);

    const transfer = createRestoredTransferOpen({ reader, workspace });
    expectCleanRestore(transfer);
    expectRestoredLegalActions(transfer, 0);
    const transferBlueFlame = requireCard(transfer.session, blueFlameCode);
    const warrior = requireCard(transfer.session, warriorCode);
    const defender = requireCard(transfer.session, defenderCode);
    const attack = getLuaRestoreLegalActions(transfer, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === transferBlueFlame.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(transfer, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(transfer, attack!);
    passBattleAction(transfer, 1, "passAttack");
    passBattleAction(transfer, 0, "passAttack");
    expect(transfer.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 1 });
    passBattleAction(transfer, 1, "passDamage");
    const transferAction = getLuaRestoreLegalActions(transfer, 0).find((action) =>
      action.type === "activateEffect" && action.uid === transferBlueFlame.uid && action.effectId === "lua-1-1002"
    );
    expect(transferAction, JSON.stringify(getLuaRestoreLegalActions(transfer, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(transfer, transferAction!);
    resolveRestoredChain(transfer);
    expect(currentAttack(transfer.session.state.cards.find((card) => card.uid === transferBlueFlame.uid), transfer.session.state)).toBe(1200);
    expect(currentAttack(transfer.session.state.cards.find((card) => card.uid === warrior.uid), transfer.session.state)).toBe(2100);
    expect(transfer.session.state.cards.find((card) => card.uid === transferBlueFlame.uid)).toMatchObject({ attackModifier: -600 });
    expect(transfer.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ attackModifier: 600 });
    expect(transfer.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [transferBlueFlame.uid, warrior.uid].includes(effect.sourceUid ?? ""))).toEqual([]);

    const grave = createRestoredReviveOpen({ reader, workspace });
    expectCleanRestore(grave);
    expectRestoredLegalActions(grave, 0);
    const graveBlueFlame = requireCard(grave.session, blueFlameCode);
    const revive = requireCard(grave.session, reviveCode);
    sendDuelCardToGraveyard(grave.session.state, graveBlueFlame.uid, 0, duelReason.destroy | duelReason.effect, 1);
    expect(grave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1014",
        eventCardUid: graveBlueFlame.uid,
        eventCode: 1014,
        eventName: "sentToGraveyard",
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: graveBlueFlame.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(grave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const reviveAction = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveBlueFlame.uid && action.effectId === "lua-2-1014"
    );
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, reviveAction!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveBlueFlame.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveBlueFlame.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveBlueFlame.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveBlueFlame.uid, eventReason: duelReason.destroy | duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveBlueFlame.uid, eventReason: duelReason.cost, eventReasonCardUid: graveBlueFlame.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: revive.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: graveBlueFlame.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredTransferOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 50903514, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blueFlameCode, warriorCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, blueFlameCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, warriorCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blueFlameCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredReviveOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 50903515, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blueFlameCode, reviveCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, blueFlameCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, reviveCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blueFlameCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Blue Flame Swordsman");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition() end)");
  expect(script).toContain("c:UpdateAttack(-600)==-600");
  expect(script).toContain("tc:UpdateAttack(600,nil,c)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return rp==1-tp and c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT) and c:IsPreviousControler(tp)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_FIRE) and c:IsRace(RACE_WARRIOR) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
