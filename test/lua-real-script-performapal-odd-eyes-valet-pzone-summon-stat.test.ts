import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const valetCode = "82661461";
const sendTargetCode = "826614610";
const wrongSetCode = "826614611";
const selfCodeDecoy = "82661461";
const extraPendulumACode = "826614612";
const extraPendulumBCode = "826614613";
const opponentAttackerCode = "826614614";
const defenderCode = "826614615";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasValetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${valetCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const attributeLight = 0x10;
const setPerformapal = 0x9f;
const setOddEyes = 0x99;
const effectUpdateAttack = 100;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasValetScript)("Lua real script Performapal Odd-Eyes Valet PZone summon stat", () => {
  it("restores summon send-Level change, destroyed PZone placement, and PZone attack ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${valetCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonedValet = requireCard(restoredSummon.session, valetCode);
    const sendTarget = requireCard(restoredSummon.session, sendTargetCode);
    const wrongSet = requireCard(restoredSummon.session, wrongSetCode);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1100",
        sourceUid: summonedValet.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonedValet.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === summonedValet.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    passRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === sendTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonedValet.uid,
      reasonEffectId: 4,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === wrongSet.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentLevel(restoredSummon.session.state.cards.find((card) => card.uid === summonedValet.uid), restoredSummon.session.state)).toBe(6);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonedValet.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, reset: { flags: 1107235328 }, sourceUid: summonedValet.uid, value: 6 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonedValet.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: sendTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonedValet.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredDestroyed = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedValet = requireCard(restoredDestroyed.session, valetCode);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedValet.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, pzoneTrigger!);
    passRestoredChain(restoredDestroyed);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedValet.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: destroyedValet.uid,
      reasonEffectId: 6,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "moved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPreviousState: event.eventPreviousState,
      eventCurrentState: event.eventCurrentState,
    }))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: destroyedValet.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedValet.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedValet.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedValet.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: destroyedValet.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedValet.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const pzoneValet = requireCard(restoredAttack.session, valetCode);
    const opponentAttacker = requireCard(restoredAttack.session, opponentAttackerCode);
    const defender = requireCard(restoredAttack.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredAttack, 1).find((action) => action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    expect(restoredAttackTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: opponentAttacker.uid,
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: pzoneValet.uid,
        triggerBucket: "opponentOptional",
      },
    ]);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pzoneValet.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackTrigger!);
    passRestoredChain(restoredAttackTrigger);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === opponentAttacker.uid), restoredAttackTrigger.session.state)).toBe(1800);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponentAttacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentAttacker.uid, value: -600 },
    ]);
    expect(restoredAttackTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82661461, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [valetCode, sendTargetCode, wrongSetCode] }, 1: { main: [] } });
  startDuel(session);
  const valet = requireCard(session, valetCode);
  moveDuelCard(session.state, valet.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(valetCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === valet.uid);
  expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, normalSummon!);
  return restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82661462, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [valetCode] }, 1: { main: [] } });
  startDuel(session);
  const valet = requireCard(session, valetCode);
  moveFaceUpAttack(session, valet, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(valetCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  destroyDuelCard(session.state, valet.uid, 0, duelReason.effect | duelReason.destroy, 0, "extraDeck", {
    eventReasonCardUid: valet.uid,
    eventReasonEffectId: 99,
  });
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82661463, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [valetCode, defenderCode], extra: [extraPendulumACode, extraPendulumBCode] }, 1: { main: [opponentAttackerCode] } });
  startDuel(session);
  const valet = requireCard(session, valetCode);
  const extraA = requireCard(session, extraPendulumACode);
  const extraB = requireCard(session, extraPendulumBCode);
  const opponentAttacker = requireCard(session, opponentAttackerCode);
  const defender = requireCard(session, defenderCode);
  movePzone(session, valet, 0, 0);
  extraA.faceUp = true;
  extraB.faceUp = true;
  moveFaceUpAttack(session, defender, 0, 0);
  moveFaceUpAttack(session, opponentAttacker, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(valetCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsType,TYPE_PENDULUM),tp,LOCATION_EXTRA,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-pc*300)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_LVCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(tc:GetLevel())");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.CheckPendulumZones(tp)");
  expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
}

function cards(): DuelCardData[] {
  return [
    { code: valetCode, name: "Performapal Odd-Eyes Valet", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeDark, level: 1, attack: 100, defense: 100, leftScale: 8, rightScale: 8, setcodes: [setPerformapal, setOddEyes] },
    { code: sendTargetCode, name: "Valet Performapal Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 1500, defense: 1000, setcodes: [setPerformapal] },
    { code: wrongSetCode, name: "Valet Wrong Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 7, attack: 1700, defense: 1000, setcodes: [0x123] },
    { code: extraPendulumACode, name: "Valet Extra Pendulum A", kind: "extra", typeFlags: typeMonster | typePendulum, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
    { code: extraPendulumBCode, name: "Valet Extra Pendulum B", kind: "extra", typeFlags: typeMonster | typePendulum, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000, leftScale: 2, rightScale: 2 },
    { code: opponentAttackerCode, name: "Valet Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: defenderCode, name: "Valet Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
