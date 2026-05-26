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
const acidCloudCode = "17810268";
const cloudianAllyCode = "178102680";
const spellTargetCode = "178102681";
const trapTargetCode = "178102682";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAcidCloudScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${acidCloudCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x2;
const setCloudian = 0x18;
const counterFog = 0x1019;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAcidCloudScript)("Lua real script Cloudian Acid Cloud counter destroy", () => {
  it("restores Cloudian-count summon counters, Fog Counter cost, and targeted Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${acidCloudCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const acidCloud = requireCard(restoredSummon.session, acidCloudCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === acidCloud.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const triggerAcidCloud = requireCard(restoredTrigger.session, acidCloudCode);
    const counterTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === triggerAcidCloud.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, counterTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(requireCard(restoredTrigger.session, acidCloudCode), counterFog)).toBe(2);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: acidCloud.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: acidCloud.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: acidCloud.uid, eventReasonEffectId: 3 },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyAcidCloud = requireCard(restoredDestroy.session, acidCloudCode);
    const spellTarget = requireCard(restoredDestroy.session, spellTargetCode);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyAcidCloud.uid && action.effectId === "lua-4"
    );
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, destroyAcidCloud.uid), counterFog)).toBe(0);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, spellTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyAcidCloud.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["counterRemoved", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: destroyAcidCloud.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyAcidCloud.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyAcidCloud.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const acidCloud = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === acidCloudCode);
  expect(acidCloud).toBeDefined();
  return [
    acidCloud!,
    { code: cloudianAllyCode, name: "Acid Cloud Cloudian Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, setcodes: [setCloudian], level: 4, attack: 900, defense: 1000 },
    { code: spellTargetCode, name: "Acid Cloud Spell Target", kind: "spell", typeFlags: typeSpell },
    { code: trapTargetCode, name: "Acid Cloud Trap Target", kind: "trap", typeFlags: typeTrap },
  ];
}

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17810268, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [acidCloudCode, cloudianAllyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, acidCloudCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, cloudianAllyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerAcidCloud(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 17810269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [acidCloudCode, spellTargetCode, trapTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const acidCloud = moveFaceUpAttack(session, requireCard(session, acidCloudCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, spellTargetCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, trapTargetCode), 0, 1);
  expect(addDuelCardCounter(acidCloud, counterFog, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerAcidCloud(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerAcidCloud(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(acidCloudCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cloudian - Acid Cloud");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_CLOUDIAN),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,2,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FOG,2,REASON_COST)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
