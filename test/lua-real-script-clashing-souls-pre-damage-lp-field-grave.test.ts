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
const clashingSoulsCode = "57496978";
const attackerCode = "574969780";
const defenderCode = "574969781";
const playerFieldCode = "574969782";
const opponentFieldCode = "574969783";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasClashingSoulsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clashingSoulsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectUpdateAttack = 100;
const effectAvoidBattleDamage = 201;

const promptOverrides = [
  { api: "SelectYesNo" as const, player: 0 as const, returned: true },
  { api: "SelectYesNo" as const, player: 0 as const, returned: true },
];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasClashingSoulsScript)("Lua real script Clashing Souls pre-damage LP field grave", () => {
  it("restores repeated LP-cost ATK boosts, battle damage prevention, and battled field send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${clashingSoulsCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 57496978, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [clashingSoulsCode, attackerCode, playerFieldCode] },
      1: { main: [defenderCode, opponentFieldCode] },
    });
    startDuel(session);

    const clashingSouls = requireCard(session, clashingSoulsCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    const playerField = requireCard(session, playerFieldCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveDuelCard(session.state, clashingSouls.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, playerField, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    moveFaceUpAttack(session, opponentField, 1, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(clashingSoulsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    advanceToClashingSouls(restoredOpen, clashingSouls.uid);
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === clashingSouls.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([
      { api: "SelectYesNo", player: 0, returned: true },
      { api: "SelectYesNo", player: 0, returned: true },
    ]);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid").map((event) => ({
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 500 },
      { eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 500 },
    ]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === attacker.uid), restoredOpen.session.state)).toBe(2000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169344 }, sourceUid: attacker.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 1107169344 }, sourceUid: attacker.uid, value: 500 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectAvoidBattleDamage).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([{ code: effectAvoidBattleDamage, reset: { flags: 1073741856 }, targetRange: [1, 1] }]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredBoosted);
    expect(currentAttack(restoredBoosted.session.state.cards.find((card) => card.uid === attacker.uid), restoredBoosted.session.state)).toBe(2000);
    expect(restoredBoosted.session.state.effects.filter((effect) => effect.code === effectAvoidBattleDamage).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([{ code: effectAvoidBattleDamage, reset: { flags: 1073741856 }, targetRange: [1, 1] }]);
    passRestoredBattleResponses(restoredBoosted);
    expect(restoredBoosted.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBoosted.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredBoosted.session.state.players[1].lifePoints).toBe(8000);
    expect([attacker, defender, playerField, opponentField].map((card) => findCard(restoredBoosted.session, card.uid)).map((card) => ({
      controller: card.controller,
      location: card.location,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { controller: 0, location: "graveyard", reason: duelReason.effect, reasonCardUid: clashingSouls.uid, reasonEffectId: 5, reasonPlayer: 0 },
      { controller: 1, location: "graveyard", reason: duelReason.effect, reasonCardUid: clashingSouls.uid, reasonEffectId: 5, reasonPlayer: 0 },
      { controller: 0, location: "graveyard", reason: duelReason.effect, reasonCardUid: clashingSouls.uid, reasonEffectId: 5, reasonPlayer: 0 },
      { controller: 1, location: "graveyard", reason: duelReason.effect, reasonCardUid: clashingSouls.uid, reasonEffectId: 5, reasonPlayer: 0 },
    ]);
    expect(restoredBoosted.session.state.eventHistory.filter((event) => ["sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: clashingSouls.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: attacker.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: playerField.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: defender.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: opponentField.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: attacker.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: clashingSouls.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: [attacker.uid, playerField.uid, defender.uid, opponentField.uid], relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const clashingSouls = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === clashingSoulsCode);
  expect(clashingSouls).toBeDefined();
  return [
    clashingSouls!,
    { code: attackerCode, name: "Clashing Souls Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Clashing Souls Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
    { code: playerFieldCode, name: "Clashing Souls Player Field", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    { code: opponentFieldCode, name: "Clashing Souls Opponent Field", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Clashing Souls");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("a:IsAttackPos() and d:IsAttackPos() and a:GetAttack()<d:GetAttack()");
  expect(script).toContain("Duel.CheckLPCost(tc:GetControler(),500)");
  expect(script).toContain("Duel.SelectYesNo(tc:GetControler(),aux.Stringid(id,0))");
  expect(script).toContain("Duel.PayLPCost(tc:GetControler(),500)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_ONFIELD,0)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SendtoGrave(tg,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function advanceToClashingSouls(restored: ReturnType<typeof restoreDuelWithLuaScripts>, clashingSoulsUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === clashingSoulsUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
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
