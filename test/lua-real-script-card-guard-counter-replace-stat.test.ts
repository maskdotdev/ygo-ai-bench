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
const cardGuardCode = "4694209";
const allyCode = "46942090";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCardGuardScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cardGuardCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const categoryCounter = 0x800000;
const counterGuard = 0x1021;
const effectUpdateAttack = 100;
const effectDestroyReplace = 50;
const eventSummonSuccess = 1100;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasCardGuardScript)("Lua real script Card Guard counter replace stat", () => {
  it("restores summon Guard Counter placement, ATK scaling, and ignition-granted destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCardGuardScriptShape(workspace.readScript(`official/c${cardGuardCode}.lua`));
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const cardGuard = requireCard(session, cardGuardCode);
    const ally = requireCard(session, allyCode);
    registerScript(session, workspace);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === cardGuard.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryCounter, code: eventSummonSuccess, countLimit: undefined, event: "trigger", id: "lua-1-1100", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: categoryCounter, code: eventSpecialSummonSuccess, countLimit: undefined, event: "trigger", id: "lua-2-1102", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-3-100", property: 131072, range: ["monsterZone"] },
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-4", property: 16, range: ["monsterZone"] },
    ]);

    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, cardGuard.uid, "normalSummon"));
    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, cardGuard.uid, "activateTrigger"));
    resolveRestoredChain(restoredSummon);

    expect(getDuelCardCounter(findCard(restoredSummon.session, cardGuard.uid), counterGuard)).toBe(1);
    expect(currentAttack(findCard(restoredSummon.session, cardGuard.uid), restoredSummon.session.state)).toBe(1900);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: eventSummonSuccess, eventCardUid: cardGuard.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: cardGuard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cardGuard.uid, eventReasonEffectId: 1 },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === cardGuard.uid && action.effectId === "lua-4"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    expect(getDuelCardCounter(findCard(restoredIgnition.session, cardGuard.uid), counterGuard)).toBe(0);
    expect(getDuelCardCounter(findCard(restoredIgnition.session, ally.uid), counterGuard)).toBe(1);
    expect(currentAttack(findCard(restoredIgnition.session, cardGuard.uid), restoredIgnition.session.state)).toBe(1600);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === ally.uid && effect.code === effectDestroyReplace).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDestroyReplace, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 33427456 }, sourceUid: ally.uid },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["counterRemoved", "counterAdded"].includes(event.eventName)).slice(-2).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCardUid: cardGuard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cardGuard.uid, eventReasonEffectId: 4 },
      { eventName: "counterAdded", eventCardUid: ally.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cardGuard.uid, eventReasonEffectId: 4 },
    ]);

    const eventStart = restoredIgnition.session.state.eventHistory.length;
    destroyDuelCard(restoredIgnition.session.state, ally.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restoredIgnition.session, ally.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(getDuelCardCounter(findCard(restoredIgnition.session, ally.uid), counterGuard)).toBe(0);
    expect(restoredIgnition.session.state.eventHistory.slice(eventStart).filter((event) => ["counterRemoved", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCardUid: ally.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: 5 },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 4694209, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cardGuardCode, allyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, cardGuardCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerScript(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cardGuardCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectCardGuardScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Card Guard");
  expect(script).toContain("s.counter_place_list={0x1021}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x1021)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1021+COUNTER_NEED_ENABLE,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:GetCounter(0x1021)*300");
  expect(script).toContain("e4:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x1021,1,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,0,1,1,e:GetHandler())");
  expect(script).toContain("c:RemoveCounter(tp,0x1021,1,REASON_EFFECT)");
  expect(script).toContain("tc:AddCounter(0x1021,1)");
  expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("return not e:GetHandler():IsReason(REASON_REPLACE+REASON_RULE) and e:GetHandler():GetCounter(0x1021)>0");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1021,1,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: cardGuardCode, name: "Card Guard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 500 },
    { code: allyCode, name: "Card Guard Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1200 },
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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
