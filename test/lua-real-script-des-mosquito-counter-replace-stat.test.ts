import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const desMosquitoCode = "33695750";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDesMosquitoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${desMosquitoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const attributeDark = 0x20;
const categoryCounter = 0x800000;
const counterDesMosquito = 0x27;
const effectUpdateAttack = 100;
const effectDestroyReplace = 50;
const eventSummonSuccess = 1100;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasDesMosquitoScript)("Lua real script Des Mosquito counter replace stat", () => {
  it("restores summon counters, ATK scaling, and battle destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectDesMosquitoScriptShape(workspace.readScript(`official/c${desMosquitoCode}.lua`));
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const mosquito = requireCard(session, desMosquitoCode);
    registerScript(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === mosquito.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 65575, countLimit: undefined, event: "continuous", id: "lua-1-65575", property: undefined, range: ["hand"] },
      { category: categoryCounter, code: eventSummonSuccess, countLimit: undefined, event: "trigger", id: "lua-2-1100", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: categoryCounter, code: eventSpecialSummonSuccess, countLimit: undefined, event: "trigger", id: "lua-3-1102", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-4-100", property: 131072, range: ["monsterZone"] },
      { category: undefined, code: effectDestroyReplace, countLimit: undefined, event: "continuous", id: "lua-5-50", property: 131072, range: ["monsterZone"] },
    ]);

    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, mosquito.uid, "normalSummon"));
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    applyRestoredActionAndAssert(restoredTrigger, requireAction(restoredTrigger, mosquito.uid, "activateTrigger"));
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, mosquito.uid), counterDesMosquito)).toBe(2);
    expect(currentAttack(findCard(restoredTrigger.session, mosquito.uid), restoredTrigger.session.state)).toBe(2500);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: eventSummonSuccess, eventCardUid: mosquito.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: mosquito.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mosquito.uid, eventReasonEffectId: 2 },
    ]);

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    const eventStart = restoredReplacement.session.state.eventHistory.length;
    destroyDuelCard(restoredReplacement.session.state, mosquito.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(findCard(restoredReplacement.session, mosquito.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(getDuelCardCounter(findCard(restoredReplacement.session, mosquito.uid), counterDesMosquito)).toBe(1);
    expect(currentAttack(findCard(restoredReplacement.session, mosquito.uid), restoredReplacement.session.state)).toBe(2000);
    expect(restoredReplacement.session.state.eventHistory.slice(eventStart).filter((event) => ["counterRemoved", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: mosquito.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mosquito.uid, eventReasonEffectId: 5 },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 33695750, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [desMosquitoCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, desMosquitoCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerScript(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(desMosquitoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectDesMosquitoScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Des Mosquito");
  expect(script).toContain("c:EnableCounterPermit(0x27)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x27)");
  expect(script).toContain("e:GetHandler():AddCounter(0x27,2)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:GetCounter(0x27)*500");
  expect(script).toContain("e4:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("return e:GetHandler():IsReason(REASON_BATTLE)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x27,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x27,1,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: desMosquitoCode, name: "Des Mosquito", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 3, attack: 1500, defense: 1000 },
  ];
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

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
