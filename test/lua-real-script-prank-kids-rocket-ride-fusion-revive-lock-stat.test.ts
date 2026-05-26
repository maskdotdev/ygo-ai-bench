import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rocketCode = "18514525";
const prankA = "185145250";
const prankB = "185145251";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRocketScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rocketCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const racePyro = 0x80;
const raceThunder = 0x1000;
const attributeFire = 0x4;
const attributeWind = 0x10;
const setPrankKids = 0x120;
const summonTypeFusion = 0x43000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasRocketScript)("Lua real script Prank-Kids Rocket Ride fusion revive lock stat", () => {
  it("restores Fusion Summon ATK loss/direct attack and self-tribute two-name revive with cannot-attack locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rocketCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredFusion = createRestoredFusionTrigger({ reader, workspace });
    expectCleanRestore(restoredFusion);
    expectRestoredLegalActions(restoredFusion, 0);
    const fusionRocket = requireCard(restoredFusion.session, rocketCode);
    const fusionTrigger = getLuaRestoreLegalActions(restoredFusion, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fusionRocket.uid
    );
    expect(fusionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFusion, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFusion, fusionTrigger!);
    passRestoredChain(restoredFusion);

    expect(currentAttack(restoredFusion.session.state.cards.find((card) => card.uid === fusionRocket.uid), restoredFusion.session.state)).toBe(1000);
    expect(restoredFusion.session.state.effects.filter((effect) => effect.sourceUid === fusionRocket.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, description: undefined, event: "continuous", property: undefined, reset: { flags: 1107169792 }, sourceUid: fusionRocket.uid, value: -1000 },
    ]);

    const restoredRevive = createRestoredReviveOpen({ reader, workspace });
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const reviveRocket = requireCard(restoredRevive.session, rocketCode);
    const reviveA = requireCard(restoredRevive.session, prankA);
    const reviveB = requireCard(restoredRevive.session, prankB);
    const reviveAction = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateEffect" && action.uid === reviveRocket.uid
    );
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, reviveAction!);
    passRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === reviveRocket.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: reviveRocket.uid,
      reasonEffectId: 3,
    });
    expect([reviveA.uid, reviveB.uid].map((uid) => restoredRevive.session.state.cards.find((card) => card.uid === uid)).map((card) => ({
      uid: card?.uid,
      location: card?.location,
      controller: card?.controller,
      faceUp: card?.faceUp,
      summonType: card?.summonType,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { uid: reviveA.uid, location: "monsterZone", controller: 0, faceUp: true, summonType: "special", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: reviveRocket.uid, reasonEffectId: 3 },
      { uid: reviveB.uid, location: "monsterZone", controller: 0, faceUp: true, summonType: "special", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: reviveRocket.uid, reasonEffectId: 3 },
    ]);
    expect(restoredRevive.session.state.eventHistory.filter((event) => event.eventName === "released" || event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: reviveRocket.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: reviveRocket.uid, eventReasonEffectId: 3 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveA.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: reviveRocket.uid, eventReasonEffectId: 3 },
    ]);
    expect(restoredRevive.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredFusionTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 18514525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [rocketCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rocketCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  specialSummonDuelCard(session.state, requireCard(session, rocketCode).uid, 0, 0, {}, summonTypeFusion, true, true);
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredReviveOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 18514526, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [prankA, prankB], extra: [rocketCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, rocketCode), 0, 0).summonType = "fusion";
  moveDuelCard(session.state, requireCard(session, prankA).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, prankB).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rocketCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Prank-Kids Rocket Ride");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PRANK_KIDS),2)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("e2:SetCost(Cost.SelfTribute)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.spcheck,1,tp,HINTMSG_SPSUMMON)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: rocketCode, name: "Prank-Kids Rocket Ride", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: racePyro, attribute: attributeFire, level: 5, attack: 2000, defense: 0, setcodes: [setPrankKids] },
    { code: prankA, name: "Prank-Kids Revive A", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 3, attack: 1500, defense: 500, setcodes: [setPrankKids] },
    { code: prankB, name: "Prank-Kids Revive B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeWind, level: 3, attack: 1000, defense: 1000, setcodes: [setPrankKids] },
  ];
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
