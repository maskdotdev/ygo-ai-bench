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
const diaboundCode = "51644030";
const attackTargetCode = "516440300";
const quickAttackerCode = "516440301";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDiaboundScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${diaboundCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const standbyPhaseCode = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDiaboundScript)("Lua real script Diabound Kernel attack announce temporary banish stat", () => {
  it("restores attack-announcement ATK gain and Damage Step target ATK loss temporary self-banish return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${diaboundCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredAttack = createRestoredBattleField({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackingDiabound = requireCard(restoredAttack.session, diaboundCode);
    const attackTarget = requireCard(restoredAttack.session, attackTargetCode);
    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attackingDiabound.uid && action.targetUid === attackTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);

    expect(restoredAttack.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1130", eventCardUid: attackingDiabound.uid, eventCode: 1130, eventName: "attackDeclared", eventPlayer: 0, eventReason: 0, eventTriggerTiming: "when", player: 0, sourceUid: attackingDiabound.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === attackingDiabound.uid && action.effectId === "lua-1-1130"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attackingDiabound.uid), restoredTrigger.session.state)).toBe(2400);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === attackingDiabound.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: attackingDiabound.uid, value: 600 },
    ]);

    const restoredQuick = createRestoredBattleField({ reader, workspace, opponentTurn: true });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 1);
    const quickDiabound = requireCard(restoredQuick.session, diaboundCode);
    const quickAttacker = requireCard(restoredQuick.session, quickAttackerCode);
    const quickAttack = getLuaRestoreLegalActions(restoredQuick, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === quickAttacker.uid && action.targetUid === quickDiabound.uid
    );
    expect(quickAttack, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quickAttack!);
    const attackAnnounceTrigger = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === quickDiabound.uid && action.effectId === "lua-1-1130"
    );
    expect(attackAnnounceTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, attackAnnounceTrigger!);
    resolveRestoredChain(restoredQuick);
    passRestoredBattleAction(restoredQuick, 0, "passAttack");
    passRestoredBattleAction(restoredQuick, 1, "passAttack");
    passRestoredBattleAction(restoredQuick, 0, "passDamage");
    expect(restoredQuick.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 1 });
    passRestoredBattleAction(restoredQuick, 1, "passDamage");
    expect(restoredQuick.session.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", step: "damage", responsePlayer: 0 });
    expectRestoredLegalActions(restoredQuick, 0);
    const quickEffect = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === quickDiabound.uid && action.effectId === "lua-2-1002"
    );
    expect(quickEffect, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quickEffect!);
    resolveRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickDiabound.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.temporary,
      reasonPlayer: 0,
      reasonCardUid: quickDiabound.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === quickAttacker.uid), restoredQuick.session.state)).toBe(600);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === quickAttacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: quickAttacker.uid, value: -2400 },
    ]);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === quickDiabound.uid && effect.code === standbyPhaseCode).map((effect) => ({
      code: effect.code,
      label: effect.label,
      labelObjectUid: effect.labelObjectUid,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: standbyPhaseCode, label: 1, labelObjectUid: quickDiabound.uid, reset: { flags: 1107165186 }, sourceUid: quickDiabound.uid },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget", "breakEffect", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: quickAttacker.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: quickAttacker.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: quickDiabound.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: quickDiabound.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: quickDiabound.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "banished" },
    ]);
    finishRestoredBattle(restoredQuick);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turn = 2;
    restoredReturn.session.state.turnPlayer = 0;
    restoredReturn.session.state.phase = "draw";
    restoredReturn.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredReturn, 0);
    const standby = getLuaRestoreLegalActions(restoredReturn, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, standby!);
    expect(restoredReturn.session.state.cards.find((card) => card.uid === quickDiabound.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: quickDiabound.uid,
      reasonEffectId: 5,
    });
    expect(restoredReturn.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBattleField({
  reader,
  workspace,
  opponentTurn = false,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  opponentTurn?: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: opponentTurn ? 51644031 : 51644030, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [diaboundCode, attackTargetCode] }, 1: { main: [quickAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, diaboundCode), 0, 0);
  if (!opponentTurn) moveFaceUpAttack(session, requireCard(session, attackTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, quickAttackerCode), 1, opponentTurn ? 0 : 1);
  session.state.phase = "battle";
  session.state.turnPlayer = opponentTurn ? 1 : 0;
  session.state.waitingFor = opponentTurn ? 1 : 0;
  registerDiabound(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerDiabound(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(diaboundCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Diabound Kernel");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(600)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,e:GetHandler(),1,0,0)");
  expect(script).toContain("e1:SetValue(-atk)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Remove(c,0,REASON_EFFECT|REASON_TEMPORARY)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("e2:SetLabel(Duel.GetTurnCount())");
  expect(script).toContain("e2:SetLabelObject(c)");
  expect(script).toContain("Duel.GetCurrentPhase()<=PHASE_STANDBY");
  expect(script).toContain("Duel.GetTurnCount()>e:GetLabel()");
  expect(script).toContain("Duel.ReturnToField(e:GetLabelObject())");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const diabound = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === diaboundCode);
  expect(diabound).toBeDefined();
  return [
    diabound!,
    { code: attackTargetCode, name: "Diabound Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: quickAttackerCode, name: "Diabound Damage Step Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 3000, defense: 1000 },
  ];
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

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: DuelAction["type"]): void {
  expectRestoredLegalActions(restored, player);
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
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
