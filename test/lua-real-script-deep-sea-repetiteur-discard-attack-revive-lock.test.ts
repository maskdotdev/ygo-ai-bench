import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeSynchro } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const repetiteurCode = "33467872";
const discardCode = "334678720";
const reviveCode = "334678721";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSeaSerpent = 0x400;
const attributeWater = 0x2;
const effectUpdateAttack = 100;
const effectCannotSpecialSummon = 22;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Deep Sea Repetiteur discard attack revive lock", () => {
  it("restores WATER discard quick ATK gain and Synchro to-Grave revive with non-WATER summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${repetiteurCode}.lua`);
    expectScriptShape(script);
    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const repetiteurData = databaseCards.find((card) => card.code === repetiteurCode);
    expect(repetiteurData).toBeDefined();
    const reader = createCardReader([
      repetiteurData!,
      { code: discardCode, name: "Deep Sea Repetiteur WATER Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 3, attack: 700, defense: 900 },
      { code: reviveCode, name: "Deep Sea Repetiteur WATER Revive", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 5, attack: 2100, defense: 1600 },
    ] satisfies DuelCardData[]);

    const boost = createRestoredBoostOpen({ reader, workspace });
    expectCleanRestore(boost);
    expectRestoredLegalActions(boost, 0);
    const boostRepetiteur = requireCard(boost.session, repetiteurCode);
    const discard = requireCard(boost.session, discardCode);
    const boostAction = getLuaRestoreLegalActions(boost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boostRepetiteur.uid && action.effectId === "lua-3-1002"
    );
    expect(boostAction, JSON.stringify(getLuaRestoreLegalActions(boost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost, boostAction!);
    resolveRestoredChain(boost);
    expect(boost.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: boostRepetiteur.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(boost.session.state.cards.find((card) => card.uid === boostRepetiteur.uid), boost.session.state)).toBe(2600);
    expect(boost.session.state.effects.filter((effect) => effect.sourceUid === boostRepetiteur.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: boostRepetiteur.uid, value: 800 },
    ]);

    const grave = createRestoredSynchroGraveOpen({ reader, workspace });
    expectCleanRestore(grave);
    expectRestoredLegalActions(grave, 0);
    const graveRepetiteur = requireCard(grave.session, repetiteurCode);
    const revive = requireCard(grave.session, reviveCode);
    sendDuelCardToGraveyard(grave.session.state, graveRepetiteur.uid, 0, duelReason.effect, 1);
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
        effectId: "lua-4-1014",
        eventCardUid: graveRepetiteur.uid,
        eventCode: 1014,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: graveRepetiteur.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(grave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const reviveAction = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveRepetiteur.uid && action.effectId === "lua-4-1014"
    );
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, reviveAction!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveRepetiteur.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, controller: 0, luaTargetDescriptor: "target:not-attribute:2", property: 67110912, reset: { flags: 1073742336 }, targetRange: [1, 0] },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveRepetiteur.uid, eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: revive.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: graveRepetiteur.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBoostOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33467872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [discardCode], extra: [repetiteurCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, repetiteurCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(repetiteurCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSynchroGraveOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33467873, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reviveCode], extra: [repetiteurCode] }, 1: { main: [] } });
  startDuel(session);
  const repetiteur = requireCard(session, repetiteurCode);
  moveFaceUpAttack(session, repetiteur, 0, 0);
  repetiteur.summonType = "synchro";
  repetiteur.summonTypeCode = luaSummonTypeSynchro;
  moveDuelCard(session.state, requireCard(session, reviveCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(repetiteurCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Deep Sea Repetiteur");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.DiscardHand(tp,s.atkcfilter,1,1,REASON_COST|REASON_DISCARD,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(800)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_MZONE) and c:IsSynchroSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("return not c:IsAttribute(ATTRIBUTE_WATER)");
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
