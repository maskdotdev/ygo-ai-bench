import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const counselorLilyCode = "5519829";
const hasCounselorLilyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${counselorLilyCode}.lua`));
const tunerCode = "55198290";
const synchroCode = "55198291";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const racePsychic = 0x200000;
const attributeEarth = 0x1;
const eventBeMaterial = 1108;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasCounselorLilyScript)("Lua real script Counselor Lily Synchro material LP attack", () => {
  it("restores Synchro-material trigger cost into temporary ATK gain on the Synchro monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${counselorLilyCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and r==REASON_SYNCHRO");
    expect(script).toContain("e1:SetCost(Cost.PayLP(500))");
    expect(script).toContain("local sync=c:GetReasonCard()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
    expect(script).toContain("sync:RegisterEffect(e1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 5519829, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [counselorLilyCode, tunerCode], extra: [synchroCode] }, 1: { main: [] } });
    startDuel(session);

    const lily = requireCard(session, counselorLilyCode);
    const tuner = requireCard(session, tunerCode);
    const synchro = requireCard(session, synchroCode);
    moveFaceUpAttack(session, lily, 0, 0);
    moveFaceUpAttack(session, tuner, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(counselorLilyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchroAction = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "synchroSummon" && action.uid === synchro.uid && action.materialUids.includes(lily.uid) && action.materialUids.includes(tuner.uid),
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    synchroSummonDuelCard(restoredOpen.session.state, 0, synchro.uid, [lily.uid, tuner.uid]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === lily.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [lily.uid, tuner.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1108",
        eventCardUid: lily.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.synchro,
        eventReasonCardUid: synchro.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: lily.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === lily.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: lily.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === lily.uid && action.effectId === "lua-1-1108");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.players[0]!.lifePoints).toBe(7500);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === synchro.uid), restoredTrigger.session.state)).toBe(3000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === synchro.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: synchro.uid, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: lily.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: synchro.uid, eventReasonEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: eventBeMaterial, eventCardUid: tuner.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: synchro.uid, eventReasonEffectId: undefined },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 500, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lily.uid, eventReasonEffectId: 1 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === synchro.uid), restoredStat.session.state)).toBe(3000);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: counselorLilyCode, name: "Counselor Lily", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 3, attack: 400, defense: 1500 },
    { code: tunerCode, name: "Counselor Lily Synchro Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: racePsychic, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: synchroCode, name: "Counselor Lily Synchro Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: racePsychic, attribute: attributeEarth, level: 6, attack: 2000, defense: 1600 },
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
