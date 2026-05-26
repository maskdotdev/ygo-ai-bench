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
const circuitCode = "575512";
const tunerCode = "5755120";
const nonTunerCode = "5755121";
const synchroCode = "5755122";
const discardCode = "5755123";
const opponentCode = "5755124";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCircuitScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${circuitCode}.lua`));
const setPsyFrame = 0xc1;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const typeField = 0x80000;
const racePsychic = 0x800;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasCircuitScript)("Lua real script PSY-Frame Circuit special synchro battle stat", () => {
  it("restores field spell Special Summon trigger into Lua SynchroSummon and battle discard ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${circuitCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSynchroOpen = createRestoredCircuitField({ reader, workspace, scenario: "synchro" });
    expectCleanRestore(restoredSynchroOpen);
    expectRestoredLegalActions(restoredSynchroOpen, 0);
    const synchroCircuit = requireCard(restoredSynchroOpen.session, circuitCode);
    const tuner = requireCard(restoredSynchroOpen.session, tunerCode);
    const nonTuner = requireCard(restoredSynchroOpen.session, nonTunerCode);
    const synchro = requireCard(restoredSynchroOpen.session, synchroCode);
    specialSummonDuelCard(
      restoredSynchroOpen.session.state,
      nonTuner.uid,
      0,
      0,
      { eventReasonCardUid: synchroCircuit.uid, eventReasonEffectId: 77 },
      0,
      true,
      true,
    );
    expect(restoredSynchroOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: nonTuner.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: synchroCircuit.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredSynchroTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSynchroOpen.session), workspace, reader);
    expectCleanRestore(restoredSynchroTrigger);
    expectRestoredLegalActions(restoredSynchroTrigger, 0);
    const synchroTrigger = getLuaRestoreLegalActions(restoredSynchroTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === synchroCircuit.uid
    );
    expect(synchroTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSynchroTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSynchroTrigger, synchroTrigger!);
    resolveRestoredChain(restoredSynchroTrigger);

    expect(restoredSynchroTrigger.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
      reasonCardUid: synchroCircuit.uid,
      reasonEffectId: 2,
    });
    expect(restoredSynchroTrigger.session.state.cards.find((card) => card.uid === nonTuner.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
      reasonCardUid: synchroCircuit.uid,
      reasonEffectId: 2,
    });
    expect(restoredSynchroTrigger.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
      reasonPlayer: 0,
      reasonCardUid: synchroCircuit.uid,
      reasonEffectId: 2,
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    expect(restoredSynchroTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "usedAsMaterial"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: nonTuner.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: synchroCircuit.uid, eventReasonEffectId: 77, eventReasonPlayer: 0, previous: "hand", current: "monsterZone" },
      { eventCardUid: tuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: synchro.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: nonTuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: synchro.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: synchro.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonCardUid: synchroCircuit.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restoredSynchroTrigger.session.state.effects.some((effect) => effect.sourceUid === synchroCircuit.uid && effect.code === Number(circuitCode))).toBe(false);

    const restoredBattleOpen = createRestoredCircuitField({ reader, workspace, scenario: "battle" });
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const battleCircuit = requireCard(restoredBattleOpen.session, circuitCode);
    const attacker = requireCard(restoredBattleOpen.session, tunerCode);
    const discard = requireCard(restoredBattleOpen.session, discardCode);
    const opponent = requireCard(restoredBattleOpen.session, opponentCode);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passRestoredUntilPendingTrigger(restoredBattleOpen, "battleStarted");
    expect(restoredBattleOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1132",
        eventCardUid: attacker.uid,
        eventCode: 1132,
        eventName: "battleStarted",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: battleCircuit.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleCircuit.uid
    );
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);

    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: battleCircuit.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredBattleTrigger.session.state)).toBe(1700);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredBattleTrigger.session.state)).toBe(1600);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        registryKey: `lua:${circuitCode}:lua-4-100`,
        reset: { flags: resetStandardPhaseEnd },
        sourceUid: attacker.uid,
        value: 1200,
      },
    ]);
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "battleStarted", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventCardUid: attacker.uid, eventCode: 1132, eventName: "battleStarted", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventCardUid: discard.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: battleCircuit.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === attacker.uid), restoredPersistent.session.state)).toBe(1700);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredCircuitField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "synchro" | "battle";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "synchro" ? 575512 : 575513, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  if (scenario === "synchro") {
    loadDecks(session, { 0: { main: [circuitCode, tunerCode, nonTunerCode], extra: [synchroCode] }, 1: { main: [] } });
  } else {
    loadDecks(session, { 0: { main: [circuitCode, tunerCode, discardCode] }, 1: { main: [opponentCode] } });
  }
  startDuel(session);
  moveFaceUpFieldSpell(session, requireCard(session, circuitCode));
  if (scenario === "synchro") {
    moveFaceUpAttack(session, requireCard(session, tunerCode), 0, 0);
    moveDuelCard(session.state, requireCard(session, nonTunerCode).uid, "hand", 0);
    session.state.phase = "main1";
  } else {
    moveFaceUpAttack(session, requireCard(session, tunerCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
    moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
    session.state.phase = "battle";
  }
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(circuitCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("PSY-Frame Circuit");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsSynchroSummonable,tp,LOCATION_EXTRA,0,1,nil,nil,mg)");
  expect(script).toContain("Duel.SynchroSummon(tp,sg:GetFirst(),nil,mg)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
}

function cards(): DuelCardData[] {
  return [
    { code: circuitCode, name: "PSY-Frame Circuit", kind: "spell", typeFlags: typeSpell | typeField },
    { code: tunerCode, name: "PSY-Frame Circuit Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, setcodes: [setPsyFrame], race: racePsychic, attribute: attributeLight, level: 2, attack: 500, defense: 0 },
    { code: nonTunerCode, name: "PSY-Frame Circuit Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPsyFrame], race: racePsychic, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: synchroCode, name: "PSY-Frame Circuit Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [setPsyFrame], race: racePsychic, attribute: attributeLight, level: 6, attack: 2400, defense: 1800 },
    { code: discardCode, name: "PSY-Frame Circuit Discard", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPsyFrame], race: racePsychic, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: opponentCode, name: "PSY-Frame Circuit Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
  ];
}

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
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
