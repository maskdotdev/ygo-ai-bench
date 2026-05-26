import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { CardPosition, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const clusterCode = "6022371";
const waterDragonCode = "85066822";
const bondingCode = "60223710";
const opponentEffectCode = "60223711";
const opponentSecondEffectCode = "60223712";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasClusterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clusterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;
const raceSeaSerpent = 0x40000;
const raceDinosaur = 0x10000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const setBonding = 0x100;
const effectSetAttackFinal = 102;
const effectCannotTrigger = 7;
const effectFlagSingleRangeClientHint = 0x4020000;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasClusterScript)("Lua real script Water Dragon Cluster summon zero self tribute summon stat", () => {
  it("restores summon-success ATK zero and self-tribute Quick Effect into 2 Water Dragon summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${clusterCode}.lua`));
    const reader = createCardReader(cards());

    const liveTriggerSession = createSummonTriggerField({ reader, workspace });
    const cluster = requireNthCard(liveTriggerSession, clusterCode, 0);
    const bonding = requireNthCard(liveTriggerSession, bondingCode, 0);
    const firstTarget = requireNthCard(liveTriggerSession, opponentEffectCode, 0);
    const secondTarget = requireNthCard(liveTriggerSession, opponentSecondEffectCode, 0);
    specialSummonDuelCard(
      liveTriggerSession.state,
      cluster.uid,
      0,
      0,
      { eventReasonCardUid: bonding.uid, eventReasonEffectId: 99 },
      0,
      true,
      true,
      "faceUpAttack",
    );
    expect(liveTriggerSession.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: cluster.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", player: 0, sourceUid: cluster.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(liveTriggerSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summonZero = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cluster.uid && action.effectId === "lua-3-1102");
    expect(summonZero, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summonZero!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === firstTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === secondTarget.uid), restoredTrigger.session.state)).toBe(0);
    expectTemporaryZeroAndCannotTrigger(restoredTrigger.session, [firstTarget.uid, secondTarget.uid]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === cluster.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: cluster.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: bonding.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredQuick = createSelfTributeField({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickCluster = requireNthCard(restoredQuick.session, clusterCode, 0);
    const waterDragons = requireCards(restoredQuick.session, waterDragonCode, 2);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === quickCluster.uid && action.effectId === "lua-4-1002");
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickCluster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: quickCluster.uid,
      reasonEffectId: 4,
    });

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), workspace, reader);
    expectCleanRestore(restoredSummonChain);
    resolveRestoredChain(restoredSummonChain);
    for (const waterDragon of waterDragons) {
      expect(restoredSummonChain.session.state.cards.find((card) => card.uid === waterDragon.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        position: "faceUpDefense",
        summonType: "special",
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: quickCluster.uid,
        reasonEffectId: 4,
      });
    }
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      position: event.eventCurrentState?.position,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: quickCluster.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: quickCluster.uid, eventReasonEffectId: 4, previous: "monsterZone", current: "graveyard", position: "faceUpAttack" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: quickCluster.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: quickCluster.uid, eventReasonEffectId: 4, previous: "monsterZone", current: "graveyard", position: "faceUpAttack" },
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: waterDragons[0]!.uid, eventUids: [waterDragons[0]!.uid, waterDragons[1]!.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: quickCluster.uid, eventReasonEffectId: 4, previous: "hand", current: "monsterZone", position: "faceUpDefense" },
    ]);
    expect(restoredSummonChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: clusterCode, name: "Water Dragon Cluster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 10, attack: 2800, defense: 2600 },
    { code: waterDragonCode, name: "Water Dragon A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 8, attack: 2800, defense: 2600 },
    { code: waterDragonCode, name: "Water Dragon B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 8, attack: 2800, defense: 2600 },
    { code: bondingCode, name: "Cluster Bonding Trap", kind: "trap", typeFlags: typeTrap, setcodes: [setBonding] },
    { code: opponentEffectCode, name: "Cluster Opponent Effect A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
    { code: opponentSecondEffectCode, name: "Cluster Opponent Effect B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1200 },
  ];
}

function createSummonTriggerField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 6022371, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clusterCode, bondingCode] }, 1: { main: [opponentEffectCode, opponentSecondEffectCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireNthCard(session, clusterCode, 0).uid, "hand", 0);
  moveDuelCard(session.state, requireNthCard(session, bondingCode, 0).uid, "graveyard", 0);
  moveFaceUp(session, requireNthCard(session, opponentEffectCode, 0), 1, 0, "faceUpAttack");
  moveFaceUp(session, requireNthCard(session, opponentSecondEffectCode, 0), 1, 1, "faceUpAttack");
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace);
  return session;
}

function createSelfTributeField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 6022372, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clusterCode, waterDragonCode, waterDragonCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUp(session, requireNthCard(session, clusterCode, 0), 0, 0, "faceUpAttack");
  moveDuelCard(session.state, requireCards(session, waterDragonCode, 2)[0]!.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Water Dragon Cluster");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("return sc and sc:IsSpellTrap() and sc:IsSetCard(SET_BONDING)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,2,2,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,true,false,POS_FACEUP_DEFENSE)");
}

function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clusterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectTemporaryZeroAndCannotTrigger(session: DuelSession, targetUids: string[]): void {
  expect(session.state.effects.filter((effect) => effect.code !== undefined && targetUids.includes(effect.sourceUid) && [effectSetAttackFinal, effectCannotTrigger].includes(effect.code)).map((effect) => ({
    code: effect.code,
    description: effect.description,
    property: effect.property,
    reset: effect.reset,
    sourceUid: effect.sourceUid,
    targetRange: effect.targetRange,
    value: effect.value,
  }))).toEqual([
    { code: effectSetAttackFinal, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: targetUids[0], targetRange: undefined, value: 0 },
    { code: effectCannotTrigger, description: 3302, property: effectFlagSingleRangeClientHint, reset: { flags: 1107169792 }, sourceUid: targetUids[0], targetRange: undefined, value: undefined },
    { code: effectSetAttackFinal, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: targetUids[1], targetRange: undefined, value: 0 },
    { code: effectCannotTrigger, description: 3302, property: effectFlagSingleRangeClientHint, reset: { flags: 1107169792 }, sourceUid: targetUids[1], targetRange: undefined, value: undefined },
  ]);
}

function requireNthCard(session: DuelSession, code: string, index: number): DuelCardInstance {
  const card = session.state.cards.filter((candidate) => candidate.code === code)[index];
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function moveFaceUp(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, position: CardPosition): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = position;
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
