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
const clayCode = "8820526";
const battleTargetCode = "88205260";
const extraPendulumACode = "88205261";
const extraPendulumBCode = "88205262";
const lowScaleCode = "88205263";
const highScaleCode = "88205264";
const summonPendulumACode = "88205265";
const summonPendulumBCode = "88205266";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasClayScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clayCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const eventPreDamageCalculate = 1134;
const eventSpecialSummonSuccess = 1102;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasClayScript)("Lua real script Performapal Clay Breaker tribute pendulum stat to-hand", () => {
  it("restores tribute battle ATK reduction and grave salvage after two Pendulum Summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${clayCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredBattleOpen = createRestoredBattleOpen(reader, workspace);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const clay = requireCard(restoredBattleOpen.session, clayCode);
    const battleTarget = requireCard(restoredBattleOpen.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === clay.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passUntilPendingTrigger(restoredBattleOpen);
    expect(restoredBattleOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1134", eventCardUid: clay.uid, eventCode: eventPreDamageCalculate, eventName: "beforeDamageCalculation", player: 0, sourceUid: clay.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === clay.uid && action.effectId === "lua-1-1134");
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleTrigger, battleTrigger!);
    resolveRestoredChain(restoredBattleTrigger);
    expect(currentAttack(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredBattleTrigger.session.state)).toBe(1600);
    expect(restoredBattleTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: battleTarget.uid, value: -1000 },
    ]);
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "beforeDamageCalculation", eventCode: eventPreDamageCalculate, eventCardUid: clay.uid, eventReason: 0, eventReasonPlayer: 0 },
    ]);

    const restoredSummonOpen = createRestoredPendulumOpen(reader, workspace);
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const graveClay = requireCard(restoredSummonOpen.session, clayCode);
    const pendulumA = requireCard(restoredSummonOpen.session, summonPendulumACode);
    const pendulumB = requireCard(restoredSummonOpen.session, summonPendulumBCode);
    const pendulumSummon = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action): action is Extract<DuelAction, { type: "pendulumSummon" }> =>
      action.type === "pendulumSummon" && action.summonUids.includes(pendulumA.uid) && action.summonUids.includes(pendulumB.uid)
    );
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    if (!pendulumSummon || pendulumSummon.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    applyRestoredActionAndAssert(restoredSummonOpen, { ...pendulumSummon, summonUids: [pendulumA.uid, pendulumB.uid] });
    expect(restoredSummonOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === graveClay.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: pendulumA.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventUids: [pendulumA.uid, pendulumB.uid], player: 0, sourceUid: graveClay.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const salvage = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graveClay.uid && action.effectId === "lua-2-1102");
    expect(salvage, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, salvage!);
    resolveRestoredChain(restoredSummonTrigger);
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === graveClay.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveClay.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonTrigger.host.messages).toContain(`confirmed 1: ${clayCode}`);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: pendulumA.uid, eventUids: [pendulumA.uid, pendulumB.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: graveClay.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonCardUid: graveClay.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: graveClay.uid, eventUids: [graveClay.uid], eventReason: duelReason.effect, eventReasonCardUid: graveClay.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(restoredSummonTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBattleOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession(reader, workspace, { seed: 8820526, main0: [clayCode, extraPendulumACode, extraPendulumBCode], main1: [battleTargetCode] });
  const clay = moveFaceUpAttack(session, requireCard(session, clayCode), 0, 0);
  clay.summonType = "tribute";
  clay.summonPlayer = 0;
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  moveFaceUpExtra(session, requireCard(session, extraPendulumACode), 0, 0);
  moveFaceUpExtra(session, requireCard(session, extraPendulumBCode), 0, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredPendulumOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession(reader, workspace, { seed: 8820527, main0: [clayCode, lowScaleCode, highScaleCode, summonPendulumACode, summonPendulumBCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, clayCode).uid, "graveyard", 0);
  movePendulumScale(session, requireCard(session, lowScaleCode), 0, 0);
  movePendulumScale(session, requireCard(session, highScaleCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, summonPendulumACode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, summonPendulumBCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  options: { seed: number; main0: string[]; main1: string[] },
): DuelSession {
  const session = createDuel({ seed: options.seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: options.main0 }, 1: { main: options.main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clayCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Performapal Clay Breaker");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return c:IsRelateToBattle() and bc and bc:IsFaceup() and bc:IsRelateToBattle() and c:IsTributeSummoned()");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,tp,LOCATION_EXTRA,0,nil)*500");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-ct)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("return eg:IsExists(s.cfilter,2,nil,tp)");
  expect(script).toContain("return c:IsSummonPlayer(tp) and c:IsPendulumSummoned()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,c)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const clay = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === clayCode);
  expect(clay).toBeDefined();
  return [
    clay!,
    { code: battleTargetCode, name: "Clay Breaker Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 2600, defense: 1000 },
    { code: extraPendulumACode, name: "Clay Breaker Extra Pendulum A", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: extraPendulumBCode, name: "Clay Breaker Extra Pendulum B", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: lowScaleCode, name: "Clay Breaker Low Scale", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
    { code: highScaleCode, name: "Clay Breaker High Scale", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, leftScale: 8, rightScale: 8 },
    { code: summonPendulumACode, name: "Clay Breaker Pendulum Summon A", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: summonPendulumBCode, name: "Clay Breaker Pendulum Summon B", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 5, attack: 1300, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function moveFaceUpExtra(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "extraDeck", player);
  moved.faceUp = true;
  moved.sequence = sequence;
  return moved;
}

function movePendulumScale(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
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
