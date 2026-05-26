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
const ragnarokCode = "19476824";
const topMetaphysACode = "194768240";
const topMetaphysBCode = "194768241";
const topNonMetaphysCode = "194768242";
const highMetaphysCode = "194768243";
const deckFillerCode = "194768244";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRagnarokScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ragnarokCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceWyrm = 0x800000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x8;
const setMetaphys = 0x105;
const effectUpdateAttack = 100;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasRagnarokScript)("Lua real script Metaphys Ragnarok banish summon delay stat", () => {
  it("restores summon deck-top banish ATK gain and battle-damage deck summon delayed banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ragnarokCode}.lua`);
    expectRagnarokScriptShape(script);
    const reader = createCardReader(cards());

    const summonSession = createSummonSession({ reader, workspace });
    const summonRagnarok = requireCard(summonSession, ragnarokCode);
    const topMetaphysA = requireCard(summonSession, topMetaphysACode);
    const topMetaphysB = requireCard(summonSession, topMetaphysBCode);
    const topNonMetaphys = requireCard(summonSession, topNonMetaphysCode);
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonRagnarok.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, normalSummon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1100",
        eventCardUid: summonRagnarok.uid,
        eventCode: 1100,
        eventName: "normalSummoned",
        eventReason: duelReason.summon,
        player: 0,
        sourceUid: summonRagnarok.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const banishTop = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonRagnarok.uid && action.effectId === "lua-1-1100");
    expect(banishTop, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, banishTop!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(currentAttack(restoredSummonTrigger.session.state.cards.find((card) => card.uid === summonRagnarok.uid), restoredSummonTrigger.session.state)).toBe(2100);
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === topMetaphysA.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonRagnarok.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === topMetaphysB.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonRagnarok.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === topNonMetaphys.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonRagnarok.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === summonRagnarok.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: summonRagnarok.uid, value: 600 },
    ]);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: summonRagnarok.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: topMetaphysA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonRagnarok.uid, eventReasonEffectId: 1, previous: "deck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: topMetaphysB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonRagnarok.uid, eventReasonEffectId: 1, previous: "deck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: topNonMetaphys.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonRagnarok.uid, eventReasonEffectId: 1, previous: "deck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: topMetaphysA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonRagnarok.uid, eventReasonEffectId: 1, previous: "deck", current: "banished" },
    ]);

    const battleSession = createBattleSession({ reader, workspace });
    const battleRagnarok = requireCard(battleSession, ragnarokCode);
    const highMetaphys = requireCard(battleSession, highMetaphysCode);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const directAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleRagnarok.uid && action.directAttack);
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    passBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.players[1]!.lifePoints).toBe(6500);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1143",
        eventCardUid: battleRagnarok.uid,
        eventCode: 1143,
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventReason: duelReason.battle,
        eventReasonCardUid: battleRagnarok.uid,
        eventValue: 1500,
        player: 0,
        sourceUid: battleRagnarok.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleRagnarok.uid && action.effectId === "lua-3-1143");
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleTrigger, summon!);
    resolveRestoredChain(restoredBattleTrigger);
    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === highMetaphys.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleRagnarok.uid,
      reasonEffectId: 3,
    });
    expect(restoredBattleTrigger.session.state.effects.find((effect) => effect.sourceUid === battleRagnarok.uid && effect.code === phaseEndEventCode)).toMatchObject({
      code: phaseEndEventCode,
      event: "continuous",
      label: 2,
      labelObjectUid: highMetaphys.uid,
      property: 0x80,
      sourceUid: battleRagnarok.uid,
    });
    finishRestoredBattle(restoredBattleTrigger);
    expect(restoredBattleTrigger.session.state.pendingBattle).toBeUndefined();

    const restoredDelayed = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), workspace, reader);
    expectCleanRestore(restoredDelayed);
    restoredDelayed.session.state.turn += 1;
    restoredDelayed.session.state.turnPlayer = 0;
    restoredDelayed.session.state.phase = "main2";
    restoredDelayed.session.state.waitingFor = 0;
    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredDelayed.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === highMetaphys.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: battleRagnarok.uid,
      reasonEffectId: 4,
    });
    expect(restoredEnd.session.state.eventHistory.filter((event) => ["battleDamageDealt", "specialSummoned", "phaseEnd", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: battleRagnarok.uid, eventPlayer: 1, eventValue: 1500, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: battleRagnarok.uid, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: highMetaphys.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleRagnarok.uid, eventReasonEffectId: 3, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: highMetaphys.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: battleRagnarok.uid, eventReasonEffectId: 4, previous: "monsterZone", current: "banished" },
      { eventName: "phaseEnd", eventCode: phaseEndEventCode, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
    ]);
    expect(restoredEnd.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 });
  });
});

function createSummonSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 19476824, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ragnarokCode, topMetaphysACode, topMetaphysBCode, topNonMetaphysCode, deckFillerCode] }, 1: { main: [] } });
  startDuel(session);
  const ragnarok = requireCard(session, ragnarokCode);
  moveDuelCard(session.state, ragnarok.uid, "hand", 0);
  setDeckSequence(requireCard(session, topMetaphysACode), 0);
  setDeckSequence(requireCard(session, topMetaphysBCode), 1);
  setDeckSequence(requireCard(session, topNonMetaphysCode), 2);
  setDeckSequence(requireCard(session, deckFillerCode), 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ragnarokCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 19476825, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ragnarokCode, highMetaphysCode, deckFillerCode] }, 1: { main: [] } });
  startDuel(session);
  const ragnarok = requireCard(session, ragnarokCode);
  moveFaceUpAttack(session, ragnarok, 0, 0);
  setDeckSequence(requireCard(session, highMetaphysCode), 0);
  setDeckSequence(requireCard(session, deckFillerCode), 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ragnarokCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectRagnarokScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Metaphys Ragnarok");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("local rg=Duel.GetDecktopGroup(tp,3)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,rg,3,0,0)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup()");
  expect(script).toContain("og:FilterCount(Card.IsSetCard,nil,SET_METAPHYS)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(oc*300)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("return ep~=tp");
  expect(script).toContain("return c:IsSetCard(SET_METAPHYS) and c:IsLevelAbove(5) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp):GetFirst()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e2:SetLabel(Duel.GetTurnCount()+1)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("Duel.GetTurnCount()==e:GetLabel()");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: ragnarokCode, name: "Metaphys Ragnarok", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, setcodes: [setMetaphys], race: raceWyrm, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: topMetaphysACode, name: "Metaphys Ragnarok Top Metaphys A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMetaphys], race: raceWyrm, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: topMetaphysBCode, name: "Metaphys Ragnarok Top Metaphys B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMetaphys], race: raceWyrm, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: topNonMetaphysCode, name: "Metaphys Ragnarok Top Non-Metaphys", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
    { code: highMetaphysCode, name: "Metaphys Ragnarok High-Level Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMetaphys], race: raceWyrm, attribute: attributeLight, level: 6, attack: 2400, defense: 1800 },
    { code: deckFillerCode, name: "Metaphys Ragnarok Deck Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
