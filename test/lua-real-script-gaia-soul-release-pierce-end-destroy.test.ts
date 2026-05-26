import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gaiaSoulCode = "51355346";
const pyroOneCode = "513553460";
const pyroTwoCode = "513553461";
const defenderCode = "513553462";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaiaSoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaiaSoulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasGaiaSoulScript)("Lua real script Gaia Soul release pierce end destroy", () => {
  it("restores release-cost ATK label, piercing battle damage, and End Phase self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gaiaSoulCode}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsRace,1,false,nil,e:GetHandler(),RACE_PYRO)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsRace,1,2,false,nil,e:GetHandler(),RACE_PYRO)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("e:SetLabel(#g)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(e:GetLabel()*1000)");
    expect(script).toContain("e2:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 51355346, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gaiaSoulCode, pyroOneCode, pyroTwoCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const gaiaSoul = requireCard(session, gaiaSoulCode);
    const pyroOne = requireCard(session, pyroOneCode);
    const pyroTwo = requireCard(session, pyroTwoCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, gaiaSoul, 0);
    moveFaceUpAttack(session, pyroOne, 0);
    moveFaceUpAttack(session, pyroTwo, 0);
    moveFaceUpDefense(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaiaSoulCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const boost = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === gaiaSoul.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(boost)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, boost!);

    expect(restored.session.state.cards.find((card) => card.uid === pyroOne.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: gaiaSoul.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === pyroTwo.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === gaiaSoul.uid), restored.session.state)).toBe(3000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gaiaSoul.uid && [101, 203, 0x1200].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 203, event: "continuous", property: undefined, reset: undefined, triggerEvent: undefined, value: undefined },
      { code: 4608, event: "trigger", property: undefined, reset: undefined, triggerEvent: "phaseEnd", value: undefined },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: pyroOne.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    restored.session.state.phase = "battle";
    restored.session.state.waitingFor = 0;
    expectRestoredLegalActions(restored, 0);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === gaiaSoul.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passBattle(restored);
    expect(restored.session.state.players[1].lifePoints).toBe(6900);
    expect(restored.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", reason: duelReason.battle | duelReason.destroy });
    expect(restored.session.state.eventHistory.filter((event) => ["battleDamageDealt", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: defender.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid },
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: gaiaSoul.uid, eventPlayer: 1, eventValue: 1100, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredEnd, 0);
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-4608", eventCode: 0x1200, eventName: "phaseEnd", player: 0, sourceUid: gaiaSoul.uid, triggerBucket: "turnMandatory" },
    ]);
    const destroyTrigger = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "activateTrigger" && action.uid === gaiaSoul.uid);
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(destroyTrigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredEnd, destroyTrigger!);
    resolveRestoredChain(restoredEnd);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === gaiaSoul.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gaiaSoul.uid,
      reasonEffectId: 3,
    });
    expect(restoredEnd.session.state.eventHistory.filter((event) => ["phaseEnd", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: defender.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: defender.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "phaseEnd", eventCode: 0x1200, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: gaiaSoul.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: gaiaSoul.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gaiaSoul.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gaiaSoulCode, name: "Gaia Soul the Combustible Collective", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 2000, defense: 0 },
    { code: pyroOneCode, name: "Gaia Soul Pyro Cost One", kind: "monster", typeFlags: typeMonster, race: racePyro, attribute: attributeFire, level: 4, attack: 800, defense: 800 },
    { code: pyroTwoCode, name: "Gaia Soul Non-Pyro Cost Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeFire, level: 4, attack: 900, defense: 900 },
    { code: defenderCode, name: "Gaia Soul Defense Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1900 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    if (restored.session.state.pendingTriggers.length > 0) break;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
