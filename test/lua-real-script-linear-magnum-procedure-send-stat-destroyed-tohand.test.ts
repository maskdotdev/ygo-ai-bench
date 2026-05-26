import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const linearCode = "44839512";
const fieldMagnetCode = "448395120";
const deckMagnetCode = "448395121";
const earthTargetCode = "448395122";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLinearScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${linearCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpecialSummon = 0x2000000;
const raceRock = 0x100;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setMagnetWarrior = 0x3066;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLinearScript)("Lua real script Conduction Warrior Linear Magnum procedure send stat destroyed to-hand", () => {
  it("restores Magnet Warrior send procedure, target ATK gain, and destroyed mandatory self return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${linearCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProcedure = createProcedureScenario(workspace, reader);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const linear = requireCard(restoredProcedure.session, linearCode);
    const fieldMagnet = requireCard(restoredProcedure.session, fieldMagnetCode);
    const deckMagnet = requireCard(restoredProcedure.session, deckMagnetCode);
    const summon = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) =>
      action.type === "specialSummonProcedure" && action.uid === linear.uid
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, summon!);
    expect(findCard(restoredProcedure.session, linear.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      summonType: "special",
    });
    expect(findCard(restoredProcedure.session, fieldMagnet.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: linear.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredProcedure.session, deckMagnet.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: linear.uid,
      reasonEffectId: 2,
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: fieldMagnet.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: linear.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: deckMagnet.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: linear.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "deck" },
      { current: "graveyard", eventCardUid: fieldMagnet.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: linear.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: [fieldMagnet.uid, deckMagnet.uid], previous: "monsterZone" },
      { current: "monsterZone", eventCardUid: linear.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previous: "hand" },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const earthTarget = requireCard(restoredIgnition.session, earthTargetCode);
    const boost = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === linear.uid && action.effectId === "lua-3"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, boost!);
    resolveRestoredChain(restoredIgnition);
    expect(currentAttack(findCard(restoredIgnition.session, linear.uid), restoredIgnition.session.state)).toBe(5600);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === linear.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: linear.uid, value: 1600 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: earthTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 3 },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const destroyedWindow = createDestroyedScenario(workspace, reader);
    expectCleanRestore(destroyedWindow);
    expectRestoredLegalActions(destroyedWindow, 0);
    const destroyedLinear = requireCard(destroyedWindow.session, linearCode);
    expect(destroyedWindow.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1014", eventCardUid: destroyedLinear.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, sourceUid: destroyedLinear.uid, triggerBucket: "turnMandatory" },
    ]);
    const recover = getLuaRestoreLegalActions(destroyedWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedLinear.uid && action.effectId === "lua-4-1014"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(destroyedWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(destroyedWindow, recover!);
    resolveRestoredChain(destroyedWindow);
    expect(findCard(destroyedWindow.session, destroyedLinear.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: destroyedLinear.uid,
      reasonEffectId: 4,
    });
    expect(destroyedWindow.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "sentToHand"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: destroyedLinear.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: destroyedLinear.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "monsterZone" },
      { current: "hand", eventCardUid: destroyedLinear.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: destroyedLinear.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard" },
    ]);
  });
});

function createProcedureScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession(44839512, workspace, reader, { 0: [linearCode, fieldMagnetCode, deckMagnetCode], 1: [earthTargetCode] });
  moveDuelCard(session.state, requireCard(session, linearCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, fieldMagnetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, earthTargetCode), 1, 0);
  prepareOpenState(session);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createDestroyedScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession(44839513, workspace, reader, { 0: [linearCode], 1: [] });
  const linear = requireCard(session, linearCode);
  moveFaceUpAttack(session, linear, 0, 0);
  prepareOpenState(session);
  destroyDuelCard(session.state, linear.uid, 0, duelReason.effect | duelReason.destroy, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession(
  seed: number,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
  main: { 0: string[]; 1: string[] },
): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main[0] }, 1: { main: main[1] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(linearCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: linearCode, name: "Conduction Warrior Linear Magnum Plus Minus", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpecialSummon, race: raceRock, attribute: attributeEarth, level: 8, attack: 4000, defense: 0 },
    { code: fieldMagnetCode, name: "Linear Magnum Field Magnet Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setMagnetWarrior] },
    { code: deckMagnetCode, name: "Linear Magnum Deck Magnet Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1400, defense: 1200, setcodes: [setMagnetWarrior] },
    { code: earthTargetCode, name: "Linear Magnum Earth Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3200, defense: 1800 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Conduction Warrior Linear Magnum Plus Minus");
  expect(script).toContain("s.listed_series={SET_MAGNET_WARRIOR}");
  expect(script).toContain("e0:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.GetMatchingGroup(s.spconfilter,tp,LOCATION_HAND|LOCATION_MZONE|LOCATION_DECK,0,nil)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,aux.ChkfMMZ(1),0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),1,tp,HINTMSG_TOGRAVE)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()//2)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e:GetHandler():IsReason(REASON_DESTROY)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
}

function prepareOpenState(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
