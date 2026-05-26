import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rugalCode = "52331012";
const reviveCode = "523310120";
const allyCode = "523310121";
const opponentCode = "523310122";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRugalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rugalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceWingedBeast = 0x200;
const raceBeast = 0x4000;
const raceBeastWarrior = 0x8000;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasRugalScript)("Lua real script Tri-Brigade Rugal step summon delayed stat", () => {
  it.fails("restores opponent-turn SpecialSummonStep negate/delayed return and TO_GRAVE race-count ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rugalCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const summonSession = createDuel({ seed: 52331012, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [reviveCode], extra: [rugalCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonRugal = requireCard(summonSession, rugalCode);
    const reviveTarget = requireCard(summonSession, reviveCode);
    moveFaceUpAttack(summonSession, summonRugal, 0);
    moveDuelCard(summonSession.state, reviveTarget.uid, "graveyard", 0).faceUp = true;
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 1;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(rugalCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateEffect" && action.uid === summonRugal.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    passRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: summonRugal.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
      summonType: "special",
    });
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === reviveTarget.uid && (effect.code === 2 || effect.code === 8)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { flags: 33427456, count: 1 }, sourceUid: reviveTarget.uid, value: undefined },
      { code: 8, reset: { flags: 33427456, count: 1 }, sourceUid: reviveTarget.uid, value: 131072 },
    ]);
    expect(restoredSummon.session.state.effects.find((effect) => effect.sourceUid === summonRugal.uid && effect.code === phaseEndEventCode)).toMatchObject({
      event: "continuous",
      sourceUid: summonRugal.uid,
    });
    expect(restoredSummon.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: reviveTarget.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonRugal.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    advanceRestoredToPhase(restoredEnd, 1, ["battle", "main2", "end"]);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      controller: 0,
      location: "hand",
      reason: duelReason.effect,
      reasonCardUid: summonRugal.uid,
      reasonEffectId: 6,
      reasonPlayer: 0,
    });
    expect(restoredEnd.session.state.eventHistory.filter((event) => event.eventName === "sentToHand").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: reviveTarget.uid, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: summonRugal.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
    ]);

    const statSession = createDuel({ seed: 52331013, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [reviveCode, allyCode], extra: [rugalCode] }, 1: { main: [opponentCode] } });
    startDuel(statSession);
    const statRugal = requireCard(statSession, rugalCode);
    const statRevive = requireCard(statSession, reviveCode);
    const ally = requireCard(statSession, allyCode);
    const opponent = requireCard(statSession, opponentCode);
    moveFaceUpAttack(statSession, statRugal, 0);
    moveFaceUpAttack(statSession, statRevive, 0);
    moveFaceUpAttack(statSession, ally, 0);
    moveFaceUpAttack(statSession, opponent, 1);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(rugalCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);
    sendDuelCardToGraveyard(statSession.state, statRugal.uid, 0, duelReason.effect, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const stat = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === statRugal.uid);
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, stat!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid)!, restoredTrigger.session.state)).toBe(1500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: -600 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: statRugal.uid, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACES_BEAST_BWARRIOR_WINGB),2)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp) and Duel.IsMainPhase()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("sc:NegateEffects(e:GetHandler())");
  expect(script).toContain("aux.DelayedOperation(sc,PHASE_END,id,e,tp,function(ag) Duel.SendtoHand(ag,nil,REASON_EFFECT) end,nil,0,0,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil):GetClassCount(Card.GetRace)*-300");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function cards(): DuelCardData[] {
  return [
    { code: rugalCode, name: "Tri-Brigade Rugal the Silver Sheller", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceBeastWarrior, level: 3, attack: 2300, defense: 0, linkMarkers: 0x2a },
    { code: reviveCode, name: "Rugal Beast Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, level: 4, attack: 1600, defense: 1000 },
    { code: allyCode, name: "Rugal Winged Beast Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, level: 4, attack: 1200, defense: 1000 },
    { code: opponentCode, name: "Rugal Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, level: 4, attack: 2100, defense: 1000 },
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

function advanceRestoredToPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phases: Array<"battle" | "main2" | "end">): void {
  for (const phase of phases) {
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
