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
const ladybugCode = "19605133";
const tunerCode = "196051330";
const nonTunerCode = "196051331";
const synchroCode = "196051332";
const allyCode = "196051333";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLadybugScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ladybugCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceInsect = 0x800;
const attributeEarth = 0x1;
const setNaturia = 0x2a;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLadybugScript)("Lua real script Naturia Ladybug synchro summon release stat", () => {
  it("restores Naturia Synchro summon graveyard Special Summon and self-release target ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ladybugCode}.lua`);
    expectLadybugScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSynchroOpen = createRestoredSynchroOpen({ reader, workspace });
    expectCleanRestore(restoredSynchroOpen);
    expectRestoredLegalActions(restoredSynchroOpen, 0);
    const ladybug = requireCard(restoredSynchroOpen.session, ladybugCode);
    const tuner = requireCard(restoredSynchroOpen.session, tunerCode);
    const nonTuner = requireCard(restoredSynchroOpen.session, nonTunerCode);
    const synchro = requireCard(restoredSynchroOpen.session, synchroCode);
    const synchroAction = getLuaRestoreLegalActions(restoredSynchroOpen, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === synchro.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid)
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredSynchroOpen, 0), null, 2)).toBeDefined();
    synchroSummonDuelCard(restoredSynchroOpen.session.state, 0, synchro.uid, [tuner.uid, nonTuner.uid]);

    expect(restoredSynchroOpen.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "synchro",
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
    });
    expect(restoredSynchroOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1102",
        eventCardUid: synchro.uid,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonCardUid: undefined,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: ladybug.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSynchroOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ladybug.uid && action.effectId === "lua-1-1102"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ladybug.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ladybug.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCardUid: tuner.uid, eventCode: 1108, eventReason: duelReason.synchro, eventReasonCardUid: synchro.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventName: "usedAsMaterial", eventCardUid: nonTuner.uid, eventCode: 1108, eventReason: duelReason.synchro, eventReasonCardUid: synchro.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCardUid: synchro.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCardUid: ladybug.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: ladybug.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBoost = createRestoredBoostOpen({ reader, workspace });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const fieldLadybug = requireCard(restoredBoost.session, ladybugCode);
    const ally = requireCard(restoredBoost.session, allyCode);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldLadybug.uid && action.effectId === "lua-2"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === fieldLadybug.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: fieldLadybug.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === ally.uid), restoredBoost.session.state)).toBe(2600);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: ally.uid, value: 1000 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => ["released", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCardUid: fieldLadybug.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: fieldLadybug.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCardUid: ally.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: ladybugCode, name: "Naturia Ladybug", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, setcodes: [setNaturia], level: 1, attack: 100, defense: 100 },
    { code: tunerCode, name: "Naturia Ladybug Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceInsect, attribute: attributeEarth, setcodes: [setNaturia], level: 2, attack: 700, defense: 700 },
    { code: nonTunerCode, name: "Naturia Ladybug Non-Tuner", kind: "monster", typeFlags: typeMonster, race: raceInsect, attribute: attributeEarth, setcodes: [setNaturia], level: 3, attack: 900, defense: 900 },
    { code: synchroCode, name: "Naturia Ladybug Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceInsect, attribute: attributeEarth, setcodes: [setNaturia], level: 5, attack: 2200, defense: 1800, synchroTunerMin: 1, synchroTunerMax: 1, synchroNonTunerMin: 1, synchroNonTunerMax: 99 },
    { code: allyCode, name: "Naturia Ladybug Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, setcodes: [setNaturia], level: 4, attack: 1600, defense: 1200 },
  ];
}

function createRestoredSynchroOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 19605133, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ladybugCode, tunerCode, nonTunerCode], extra: [synchroCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ladybugCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, tunerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, nonTunerCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ladybugCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBoostOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 19605134, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ladybugCode, allyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, ladybugCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ladybugCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectLadybugScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Naturia Ladybug");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("ec:IsSetCard(SET_NATURIA) and ec:IsSynchroSummoned() and ec:IsSummonPlayer(tp)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCost(Cost.Replaceable(s.atcost))");
  expect(script).toContain("Duel.Release(c,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_NATURIA),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
