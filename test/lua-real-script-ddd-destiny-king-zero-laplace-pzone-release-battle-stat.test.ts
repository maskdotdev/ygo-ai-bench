import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const laplaceCode = "21686473";
const extraDddCode = "216864730";
const releaseDddCode = "216864731";
const battleTargetCode = "216864732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLaplaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${laplaceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setDdd = 0x10af;
const effectIndestructableCount = 47;
const effectSetAttackFinal = 102;
const effectAvoidBattleDamage = 201;
const effectPierce = 203;

describe.skipIf(!hasUpstreamScripts || !hasLaplaceScript)("Lua real script D/D/D Destiny King Zero Laplace pzone release battle stat", () => {
  it("restores PZONE recovery, D/D/D release procedure, battle ATK final, and static battle protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectLaplaceScriptShape(workspace.readScript(`official/c${laplaceCode}.lua`));
    const reader = createCardReader(cards());

    const pzone = createRestoredPzone({ reader, workspace });
    expectCleanRestore(pzone);
    expectRestoredLegalActions(pzone, 0);
    const pzoneLaplace = requireCard(pzone.session, laplaceCode);
    const extraDdd = requireCard(pzone.session, extraDddCode);
    const recover = getLuaRestoreLegalActions(pzone, 0).find((action) => action.type === "activateEffect" && action.uid === pzoneLaplace.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(pzone, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(pzone, recover!);
    resolveRestoredChain(pzone);
    expect(pzone.session.state.cards.find((card) => card.uid === extraDdd.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pzoneLaplace.uid,
    });
    expect(pzone.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: extraDdd.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pzoneLaplace.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, eventValue: undefined },
      { eventCardUid: extraDdd.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: pzoneLaplace.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: [extraDdd.uid], eventValue: 1 },
      { eventCardUid: extraDdd.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: pzoneLaplace.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: [extraDdd.uid], eventValue: 1 },
    ]);
    expect(pzone.host.messages).toContain(`confirmed 1: ${extraDddCode}`);

    const procedure = createRestoredProcedure({ reader, workspace });
    expectCleanRestore(procedure);
    expectRestoredLegalActions(procedure, 0);
    const handLaplace = requireCard(procedure.session, laplaceCode);
    const releaseDdd = requireCard(procedure.session, releaseDddCode);
    const summon = getLuaRestoreLegalActions(procedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === handLaplace.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(procedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(procedure, summon!);
    expect(procedure.session.state.cards.find((card) => card.uid === releaseDdd.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: handLaplace.uid,
    });
    expect(procedure.session.state.cards.find((card) => card.uid === handLaplace.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });

    const battle = createRestoredBattle({ reader, workspace });
    expectCleanRestore(battle);
    expectRestoredLegalActions(battle, 0);
    const battleLaplace = requireCard(battle.session, laplaceCode);
    const target = requireCard(battle.session, battleTargetCode);
    expect(battle.session.state.effects.filter((effect) => effect.sourceUid === battleLaplace.uid && [effectIndestructableCount, effectAvoidBattleDamage, effectPierce].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: effectPierce, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], value: undefined },
      { code: effectIndestructableCount, countLimit: 1, event: "continuous", property: 0x20000, range: ["monsterZone"], value: undefined },
      { code: effectAvoidBattleDamage, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], value: undefined },
    ]);
    const attack = getLuaRestoreLegalActions(battle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleLaplace.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(battle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battle, attack!);
    passUntilPendingTrigger(battle.session, "battleConfirmed");
    const battleTrigger = restoreDuelWithLuaScripts(serializeDuel(battle.session), workspace, reader);
    expectCleanRestore(battleTrigger);
    expectRestoredLegalActions(battleTrigger, 0);
    const atkFinal = getLuaRestoreLegalActions(battleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleLaplace.uid);
    expect(atkFinal, JSON.stringify(getLuaRestoreLegalActions(battleTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battleTrigger, atkFinal!);
    resolveRestoredChain(battleTrigger);
    expect(currentAttack(battleTrigger.session.state.cards.find((card) => card.uid === battleLaplace.uid), battleTrigger.session.state)).toBe(3600);
    expect(battleTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleLaplace.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169344 }, sourceUid: battleLaplace.uid, value: 3600 },
    ]);
    const firstDestroy = destroyDuelCard(battleTrigger.session.state, battleLaplace.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(firstDestroy).toMatchObject({ location: "monsterZone", controller: 0 });
    const secondDestroy = destroyDuelCard(battleTrigger.session.state, battleLaplace.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(secondDestroy).toMatchObject({ location: "extraDeck", faceUp: true, reason: duelReason.battle | duelReason.destroy });
    expect(battleTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPzone({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 21686473, reader, workspace, main0: [laplaceCode], main1: [], extra0: [extraDddCode] });
  movePzone(session, requireCard(session, laplaceCode), 0, 0);
  const extra = moveDuelCard(session.state, requireCard(session, extraDddCode).uid, "extraDeck", 0);
  extra.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredProcedure({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 21686474, reader, workspace, main0: [laplaceCode, releaseDddCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, laplaceCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, releaseDddCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 21686475, reader, workspace, main0: [laplaceCode], main1: [battleTargetCode] });
  moveFaceUpAttack(session, requireCard(session, laplaceCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main0,
  main1,
  extra0 = [],
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
  extra0?: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0, extra: extra0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(laplaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectLaplaceScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_DDD) and c:IsType(TYPE_PENDULUM)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.CheckReleaseGroup(c:GetControler(),Card.IsSetCard,1,false,1,true,c,c:GetControler(),nil,false,nil,SET_DDD)");
  expect(script).toContain("Duel.SelectReleaseGroup(tp,Card.IsSetCard,1,1,false,true,true,c,nil,nil,false,nil,SET_DDD)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_CONFIRM)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(bc:GetBaseAttack()*2)");
  expect(script).toContain("e4:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e5:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
  expect(script).toContain("e6:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
}

function cards(): DuelCardData[] {
  return [
    { code: laplaceCode, name: "D/D/D Destiny King Zero Laplace", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, level: 10, attack: 0, defense: 0, leftScale: 1, rightScale: 1, setcodes: [setDdd] },
    { code: extraDddCode, name: "Zero Laplace Extra Deck D/D/D Pendulum", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, leftScale: 2, rightScale: 2, setcodes: [setDdd] },
    { code: releaseDddCode, name: "Zero Laplace Release D/D/D", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setDdd] },
    { code: battleTargetCode, name: "Zero Laplace Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
