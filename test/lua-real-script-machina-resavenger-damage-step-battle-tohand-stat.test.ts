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
const resavengerCode = "54563536";
const machinaAllyCode = "545635360";
const battleTargetCode = "545635361";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasResavengerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${resavengerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x8;
const attributeDark = 0x20;
const setMachina = 0x36;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasResavengerScript)("Lua real script Machina Resavenger damage step battle to-hand stat", () => {
  it("restores SelfToGrave damage-step Machina ATK gain and grave battle-destroying return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectResavengerScriptShape(workspace.readScript(`official/c${resavengerCode}.lua`));
    const reader = createCardReader(cards());

    const boost = createRestoredDamageStep({ reader, workspace });
    expectCleanRestore(boost);
    expectRestoredLegalActions(boost, 0);
    const boostResavenger = requireCard(boost.session, resavengerCode);
    const boostMachina = requireCard(boost.session, machinaAllyCode);
    const boostTarget = requireCard(boost.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(boost, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === boostMachina.uid && action.targetUid === boostTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(boost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost, attack!);
    advanceToQuickActivation(boost, boostResavenger.uid);
    expect(["attackNegationResponse", "beforeDamageCalculation"]).toContain(boost.session.state.battleWindow?.kind);
    const quick = getLuaRestoreLegalActions(boost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boostResavenger.uid && action.effectId === "lua-1-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(boost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost, quick!);
    resolveRestoredChain(boost);

    expect(boost.session.state.cards.find((card) => card.uid === boostResavenger.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: boostResavenger.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(boost.session.state.cards.find((card) => card.uid === boostMachina.uid), boost.session.state)).toBe(3000);
    expect(boost.session.state.effects.filter((effect) =>
      effect.sourceUid === boostMachina.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: boostMachina.uid, targetRange: undefined, value: 1200 },
    ]);
    expect(boost.session.state.eventHistory.filter((event) =>
      ["beforeDamageCalculation", "sentToGraveyard", "becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: boostMachina.uid, eventCode: 1134, eventName: "beforeDamageCalculation", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: boostResavenger.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: boostResavenger.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: boostMachina.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const recover = createRestoredBattleReturn({ reader, workspace });
    expectCleanRestore(recover);
    expectRestoredLegalActions(recover, 0);
    const recoverResavenger = requireCard(recover.session, resavengerCode);
    const recoverMachina = requireCard(recover.session, machinaAllyCode);
    const recoverTarget = requireCard(recover.session, battleTargetCode);
    const battle = getLuaRestoreLegalActions(recover, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === recoverMachina.uid && action.targetUid === recoverTarget.uid
    );
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(recover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(recover, battle!);
    passRestoredBattleUntilTrigger(recover);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(recover.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1139", eventCode: 1140, eventName: "battleDestroyed", player: 0, sourceUid: recoverResavenger.uid, triggerBucket: "turnOptional" },
    ]);
    const returnTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === recoverResavenger.uid && action.effectId === "lua-2-1139"
    );
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, returnTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === recoverTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: recoverMachina.uid,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === recoverResavenger.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: recoverResavenger.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      ["battleDestroyed", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
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
      { eventCardUid: recoverTarget.uid, eventCode: 1140, eventName: "battleDestroyed", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: recoverMachina.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: recoverResavenger.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: recoverResavenger.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "hand" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1300 });
  });
});

function createRestoredDamageStep({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 54563536, reader, workspace });
  moveDuelCard(session.state, requireCard(session, resavengerCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, machinaAllyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleReturn({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 54563537, reader, workspace });
  moveDuelCard(session.state, requireCard(session, resavengerCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, machinaAllyCode), 0, 0);
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
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [resavengerCode, machinaAllyCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(resavengerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: resavengerCode, name: "Machina Resavenger", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1200, defense: 1800, setcodes: [setMachina] },
    { code: machinaAllyCode, name: "Machina Resavenger Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200, setcodes: [setMachina] },
    { code: battleTargetCode, name: "Machina Resavenger Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 500, defense: 1000 },
  ];
}

function expectResavengerScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Machina Resavenger");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE|LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_MACHINA)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1200)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("rc:IsRelateToBattle() and rc:IsStatus(STATUS_OPPO_BATTLE)");
  expect(script).toContain("rc:IsFaceup() and rc:IsSetCard(SET_MACHINA) and rc:IsControler(tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SendtoHand(e:GetHandler(),nil,REASON_EFFECT)");
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

function advanceToQuickActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, sourceUid: string): void {
  let guard = 0;
  while (
    restored.session.state.battleWindow?.kind !== "beforeDamageCalculation"
    || !getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === sourceUid)
  ) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleResponse(restored);
  }
}

function passRestoredBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    passRestoredBattleResponse(restored);
  }
}

function passRestoredBattleResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.chain.length > 0
    ? "passChain"
    : restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation"
      ? "passDamage"
      : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify({ player, battleStep: restored.session.state.battleStep, actions: getLuaRestoreLegalActions(restored, player) }, null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    passRestoredBattleResponse(restored);
  }
}
