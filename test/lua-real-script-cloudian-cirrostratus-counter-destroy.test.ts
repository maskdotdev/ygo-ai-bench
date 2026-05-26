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
const cirroCode = "43318266";
const allyCode = "433182660";
const monsterTargetCode = "433182661";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCirroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cirroCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x10;
const setCloudian = 0x18;
const counterFog = 0x1019;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCirroScript)("Lua real script Cloudian Cirrostratus counter destroy", () => {
  it("restores explicit Cloudian face-up count counters, Fog Counter cost, and targeted monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cirroCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const cirro = requireCard(restoredSummon.session, cirroCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === cirro.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const triggerCirro = requireCard(restoredTrigger.session, cirroCode);
    const counterTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === triggerCirro.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, counterTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(requireCard(restoredTrigger.session, cirroCode), counterFog)).toBe(2);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: cirro.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: cirro.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cirro.uid, eventReasonEffectId: 3 },
    ]);

    const restoredDestroy = createRestoredDestroyState(reader, workspace);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyCirro = requireCard(restoredDestroy.session, cirroCode);
    const target = requireCard(restoredDestroy.session, monsterTargetCode);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyCirro.uid && action.effectId === "lua-4"
    );
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(getDuelCardCounter(findCard(restoredDestroy.session, destroyCirro.uid), counterFog)).toBe(0);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, destroyCirro.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyCirro.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredDestroy.session, target.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
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
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: destroyCirro.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyCirro.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyCirro.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyCirro.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyCirro.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const cirro = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cirroCode);
  expect(cirro).toBeDefined();
  return [
    cirro!,
    { code: allyCode, name: "Cirrostratus Cloudian Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, setcodes: [setCloudian], level: 4, attack: 800, defense: 1000 },
    { code: monsterTargetCode, name: "Cirrostratus Monster Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 43318266, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cirroCode, allyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, cirroCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerCirro(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 43318267, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cirroCode, monsterTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const cirro = moveFaceUpAttack(session, requireCard(session, cirroCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, monsterTargetCode), 0, 1);
  expect(addDuelCardCounter(cirro, counterFog, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerCirro(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerCirro(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cirroCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cloudian - Cirrostratus");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_CLOUDIAN)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,2,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FOG,2,REASON_COST)");
  expect(script).toContain("if chkc then return chkc:IsLocation(LOCATION_MZONE) end");
  expect(script).toContain("Duel.IsExistingTarget(aux.TRUE,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
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
