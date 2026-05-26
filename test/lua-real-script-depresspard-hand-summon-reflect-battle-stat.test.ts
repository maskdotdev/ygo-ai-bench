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
const depresspardCode = "10474647";
const opponentCode = "104746470";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDepresspardScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${depresspardCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectReflectBattleDamage = 202;

describe.skipIf(!hasUpstreamScripts || !hasDepresspardScript)("Lua real script Depresspard hand summon reflect battle stat", () => {
  it("restores hand-count summon, summon ATK set, reflected battle damage, and battle-damage ATK reset", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${depresspardCode}.lua`);
    expectDepresspardScriptShape(script);
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const depresspard = requireCard(restoredOpen.session, depresspardCode);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === depresspard.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === depresspard.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: depresspard.uid,
      reasonEffectId: 1,
    });

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const boost = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === depresspard.uid && action.effectId === "lua-2-1102"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, boost!);
    resolveRestoredChain(restoredSummon);
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === depresspard.uid), restoredSummon.session.state)).toBe(2500);
    expect(restoredSummon.session.state.effects.filter((effect) =>
      effect.sourceUid === depresspard.uid && [effectSetAttackFinal, effectReflectBattleDamage].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectReflectBattleDamage, property: 2048, reset: undefined, sourceUid: depresspard.uid, targetRange: [0, 1], value: undefined },
      { code: effectSetAttackFinal, property: undefined, reset: { count: 2, flags: 1107235328 }, sourceUid: depresspard.uid, targetRange: undefined, value: 2500 },
    ]);

    const battleOpponent = requireCard(restoredSummon.session, opponentCode);
    moveFaceUpAttack(restoredSummon.session, battleOpponent, 1, 0);
    restoredSummon.session.state.phase = "battle";
    restoredSummon.session.state.turnPlayer = 0;
    restoredSummon.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === depresspard.uid && action.targetUid === battleOpponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 1500, 1: 0 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(6500);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const resetAttack = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === depresspard.uid && action.effectId === "lua-4-1143"
    );
    expect(resetAttack, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageTrigger, resetAttack!);
    resolveRestoredChain(restoredDamageTrigger);
    expect(currentAttack(restoredDamageTrigger.session.state.cards.find((card) => card.uid === depresspard.uid), restoredDamageTrigger.session.state)).toBe(0);
    expect(restoredDamageTrigger.session.state.effects.filter((effect) =>
      effect.sourceUid === depresspard.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { count: 2, flags: 1107235328 }, sourceUid: depresspard.uid, value: 2500 },
      { code: effectSetAttackFinal, reset: { flags: 33492992 }, sourceUid: depresspard.uid, value: 0 },
    ]);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "battleDamageDealt"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: depresspard.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: depresspard.uid, eventReasonEffectId: 1 },
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: battleOpponent.uid, eventPlayer: 0, eventValue: 1500, eventReason: duelReason.battle, eventReasonPlayer: 1, eventReasonCardUid: battleOpponent.uid, eventReasonEffectId: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: depresspardCode, name: "Depresspard", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 2, attack: 100, defense: 100 },
    { code: opponentCode, name: "Depresspard Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 10474647, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [depresspardCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, depresspardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(depresspardCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectDepresspardScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Depresspard");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)==1");
  expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e:GetHandler():IsSummonType(SUMMON_TYPE_SPECIAL+1)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(2500)");
  expect(script).toContain("e3:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)");
  expect(script).toContain("e4:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("Duel.GetLP(tp)<=2000");
  expect(script).toContain("e2:SetValue(5000)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.pendingTriggers.length > 0) return;
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
