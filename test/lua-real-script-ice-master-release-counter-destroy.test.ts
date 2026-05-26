import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasIceMasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c32750510.lua"));
const iceMasterCode = "32750510";
const releaseACode = "327505100";
const releaseBCode = "327505101";
const counterTargetCode = "327505102";
const opponentCounterTargetCode = "327505103";
const counterIce = 0x1015;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIceMasterScript)("Lua real script Ice Master release counter destroy", () => {
  it("restores WATER release hand summon, Ice Counter targeting, and SelfTribute counter-monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${iceMasterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const iceMaster = requireCard(restoredSummon.session, iceMasterCode);
    const releaseA = requireCard(restoredSummon.session, releaseACode);
    const releaseB = requireCard(restoredSummon.session, releaseBCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "specialSummonProcedure" && action.uid === iceMaster.uid
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    expect(findCard(restoredSummon.session, iceMaster.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, position: "faceUpAttack", summonType: "special" });
    for (const material of [releaseA, releaseB]) {
      expect(findCard(restoredSummon.session, material.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.release | duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: iceMaster.uid,
      });
    }
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: releaseA.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: iceMaster.uid, eventReasonEffectId: 1 },
      { eventName: "released", eventCode: 1017, eventCardUid: releaseB.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: iceMaster.uid, eventReasonEffectId: 1 },
      { eventName: "released", eventCode: 1017, eventCardUid: releaseA.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: iceMaster.uid, eventReasonEffectId: 1 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: iceMaster.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredCounter = createRestoredCounterState(reader, workspace);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterIceMaster = requireCard(restoredCounter.session, iceMasterCode);
    const counterTarget = requireCard(restoredCounter.session, counterTargetCode);
    const placeCounter = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateEffect" && action.uid === counterIceMaster.uid && action.effectId === "lua-2"
    );
    expect(placeCounter, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, placeCounter!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, counterIceMaster.uid), counterIce)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredCounter.session, counterTarget.uid), counterIce)).toBe(0);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: counterIceMaster.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: counterIceMaster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: counterIceMaster.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyIceMaster = requireCard(restoredDestroy.session, iceMasterCode);
    const ownTarget = requireCard(restoredDestroy.session, counterTargetCode);
    const opponentTarget = requireCard(restoredDestroy.session, opponentCounterTargetCode);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyIceMaster.uid && action.effectId === "lua-3"
    );
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, destroyIceMaster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: destroyIceMaster.uid,
      reasonEffectId: 3,
    });
    for (const target of [ownTarget, opponentTarget]) {
      expect(findCard(restoredDestroy.session, target.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: destroyIceMaster.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["released", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: destroyIceMaster.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyIceMaster.uid, eventReasonEffectId: 3 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyIceMaster.uid, eventReasonEffectId: 3 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyIceMaster.uid, eventReasonEffectId: 3 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyIceMaster.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const iceMaster = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === iceMasterCode);
  expect(iceMaster).toBeDefined();
  return [
    iceMaster!,
    { code: releaseACode, name: "Ice Master Release A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
    { code: releaseBCode, name: "Ice Master Release B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1300, defense: 1000 },
    { code: counterTargetCode, name: "Ice Master Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1400, defense: 1000 },
    { code: opponentCounterTargetCode, name: "Ice Master Opponent Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeFire, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32750510, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [iceMasterCode, releaseACode, releaseBCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, iceMasterCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, releaseACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, releaseBCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerIceMaster(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredCounterState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32750511, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [iceMasterCode, counterTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, iceMasterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, counterTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerIceMaster(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32750512, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [iceMasterCode, counterTargetCode] }, 1: { main: [opponentCounterTargetCode] } });
  startDuel(session);
  const iceMaster = moveFaceUpAttack(session, requireCard(session, iceMasterCode), 0, 0);
  const ownTarget = moveFaceUpAttack(session, requireCard(session, counterTargetCode), 0, 1);
  const opponentTarget = moveFaceUpAttack(session, requireCard(session, opponentCounterTargetCode), 1, 0);
  expect(addDuelCardCounter(ownTarget, counterIce, 1)).toBe(true);
  expect(addDuelCardCounter(opponentTarget, counterIce, 2)).toBe(true);
  expect(getDuelCardCounter(iceMaster, counterIce)).toBe(0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerIceMaster(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerIceMaster(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(iceMasterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ice Master");
  expect(script).toContain("Duel.CheckReleaseGroup(c:GetControler(),Card.IsAttribute,2,false,2,true,c,c:GetControler(),nil,false,nil,ATTRIBUTE_WATER)");
  expect(script).toContain("Duel.SelectReleaseGroup(tp,Card.IsAttribute,2,2,false,true,true,c,nil,nil,false,nil,ATTRIBUTE_WATER)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("chkc:IsCanAddCounter(0x1015,1)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,0x1015,1)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,0x1015,1)");
  expect(script).toContain("tc:AddCounter(0x1015,1)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("return c:GetCounter(0x1015)~=0");
  expect(script).toContain("Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,e:GetHandler())");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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
  const waitingFor = restored.session.state.waitingFor;
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
