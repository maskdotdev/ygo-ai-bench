import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const clackersCode = "65155517";
const speedroidCostCode = "651555170";
const speedroidPzoneCode = "651555171";
const wrongPzoneCode = "651555172";
const windProbeCode = "651555173";
const darkProbeCode = "651555174";
const clearWingCode = "651555175";
const battleTargetCode = "651555176";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasClackersScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clackersCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceMachine = 0x2000;
const raceDragon = 0x2000;
const attributeWind = 0x8;
const attributeDark = 0x20;
const setSpeedroid = 0x2016;
const setClearWing = 0xff;
const effectAddType = 115;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasClackersScript)("Lua real script Speedroid Colonel Clackers PZone step stat", () => {
  it("restores PZone banish placement, destroyed SpecialSummonStep Tuner grant, and Extra Deck battle ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${clackersCode}.lua`));
    const reader = createCardReader(cards());

    const restoredPlace = createRestoredPzoneWindow({ reader, workspace });
    expectCleanRestore(restoredPlace);
    expectRestoredLegalActions(restoredPlace, 0);
    const placeClackers = requireCard(restoredPlace.session, clackersCode);
    const cost = requireCard(restoredPlace.session, speedroidCostCode);
    const pzoneTarget = requireCard(restoredPlace.session, speedroidPzoneCode);
    const wrongPzone = requireCard(restoredPlace.session, wrongPzoneCode);
    const placeAction = getLuaRestoreLegalActions(restoredPlace, 0).find((action) => action.type === "activateEffect" && action.uid === placeClackers.uid);
    expect(placeAction, JSON.stringify(getLuaRestoreLegalActions(restoredPlace, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPlace, placeAction!);
    resolveRestoredChain(restoredPlace);
    expect(restoredPlace.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: placeClackers.uid,
    });
    expect(restoredPlace.session.state.cards.find((card) => card.uid === pzoneTarget.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: placeClackers.uid,
    });
    expect(restoredPlace.session.state.cards.find((card) => card.uid === wrongPzone.uid)).toMatchObject({ location: "deck", controller: 0 });
    const probe = restoredPlace.host.loadScript(
      `
      local wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${windProbeCode}),0,LOCATION_HAND,0,nil)
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkProbeCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("colonel clackers can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,wind)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,dark)))
      `,
      "speedroid-colonel-clackers-special-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredPlace.host.messages).toContain("colonel clackers can special true/false");
    expect(restoredPlace.session.state.eventHistory.filter((event) => ["banished", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: placeClackers.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: placeClackers.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: pzoneTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: placeClackers.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 5 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 1 },
      },
    ]);

    const restoredDestroyed = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedClackers = requireCardWhere(restoredDestroyed.session, clackersCode, (card) => card.previousLocation === "monsterZone");
    const deckClackers = requireCardWhere(restoredDestroyed.session, clackersCode, (card) => card.location === "deck");
    expect(restoredDestroyed.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1029",
        sourceUid: destroyedClackers.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedClackers.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedClackers.uid,
        eventReasonEffectId: 99,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedClackers.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyed);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedClackers.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyedClackers.uid,
      reasonEffectId: 99,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === deckClackers.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedClackers.uid,
      reasonEffectId: 4,
    });
    expect(cardTypeFlags(restoredDestroyed.session.state.cards.find((card) => card.uid === deckClackers.uid), restoredDestroyed.session.state) & typeTuner).toBe(typeTuner);
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.sourceUid === deckClackers.uid && effect.code === effectAddType).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectAddType, reset: { flags: 33427456 }, sourceUid: deckClackers.uid, value: typeTuner },
    ]);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedClackers.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedClackers.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: deckClackers.uid,
        eventUids: [deckClackers.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedClackers.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const extraClackers = requireCard(restoredBattle.session, clackersCode);
    const clearWing = requireCard(restoredBattle.session, clearWingCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === clearWing.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    advanceToClackersBattleActivation(restoredBattle, extraClackers.uid);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    const battleAction = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === extraClackers.uid);
    expect(battleAction, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleAction!);
    resolveRestoredChain(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === extraClackers.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: extraClackers.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === clearWing.uid), restoredBattle.session.state)).toBe(3200);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === clearWing.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: clearWing.uid, value: 700 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === extraClackers.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: extraClackers.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: extraClackers.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    passRestoredBattleResponses(restoredDamage);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });
  });
});

function createRestoredPzoneWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65155517, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clackersCode, speedroidCostCode, speedroidPzoneCode, wrongPzoneCode, windProbeCode, darkProbeCode] }, 1: { main: [] } });
  startDuel(session);
  const clackers = requireCard(session, clackersCode);
  const cost = requireCard(session, speedroidCostCode);
  const windProbe = requireCard(session, windProbeCode);
  const darkProbe = requireCard(session, darkProbeCode);
  movePzone(session, clackers, 0, 0);
  moveDuelCard(session.state, cost.uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, windProbe.uid, "hand", 0);
  moveDuelCard(session.state, darkProbe.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clackersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65155518, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clackersCode, clackersCode] }, 1: { main: [] } });
  startDuel(session);
  const clackers = requireCard(session, clackersCode);
  moveFaceUpAttack(session, clackers, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clackersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  destroyDuelCard(session.state, clackers.uid, 0, duelReason.effect | duelReason.destroy, 0, "graveyard", {
    eventReasonCardUid: clackers.uid,
    eventReasonEffectId: 99,
  });
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65155519, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clearWingCode], extra: [clackersCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  const clackers = requireCard(session, clackersCode);
  const clearWing = requireCard(session, clearWingCode);
  const battleTarget = requireCard(session, battleTargetCode);
  clackers.faceUp = true;
  moveFaceUpAttack(session, clearWing, 0, 0);
  moveFaceUpAttack(session, battleTarget, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clackersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: clackersCode, name: "Speedroid Colonel Clackers", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceMachine, attribute: attributeWind, level: 6, attack: 1500, defense: 1500, leftScale: 8, rightScale: 8, setcodes: [setSpeedroid] },
    { code: speedroidCostCode, name: "Colonel Clackers Speedroid Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1200, defense: 1000, setcodes: [setSpeedroid] },
    { code: speedroidPzoneCode, name: "Colonel Clackers Speedroid Pendulum Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceMachine, attribute: attributeWind, level: 3, attack: 900, defense: 1000, leftScale: 1, rightScale: 1, setcodes: [setSpeedroid] },
    { code: wrongPzoneCode, name: "Colonel Clackers Wrong PZone Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceMachine, attribute: attributeWind, level: 3, attack: 900, defense: 1000, leftScale: 1, rightScale: 1, setcodes: [0x123] },
    { code: windProbeCode, name: "Colonel Clackers WIND Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: darkProbeCode, name: "Colonel Clackers DARK Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: clearWingCode, name: "Colonel Clackers Clear Wing Battler", kind: "monster", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeWind, level: 7, attack: 2500, defense: 2000, setcodes: [setClearWing] },
    { code: battleTargetCode, name: "Colonel Clackers Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.CheckPendulumZones(tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:AssumeProperty(ASSUME_TYPE,c:GetType()|TYPE_TUNER)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("local bc=Duel.GetBattleMonster(tp)");
  expect(script).toContain("Duel.Remove(c,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(700)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCardWhere(session: DuelSession, code: string, predicate: (card: DuelCardInstance) => boolean): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && predicate(candidate));
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function advanceToClackersBattleActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, clackersUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateTrigger" && action.uid === clackersUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
