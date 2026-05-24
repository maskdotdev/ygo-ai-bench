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
const envoyCode = "38695361";
const gaiaCode = "386953610";
const battleTargetCode = "386953611";
const lightCostCode = "386953612";
const darkCostCode = "386953613";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEnvoyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${envoyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setGaiaFierceKnight = 0xbd;
const setBlackLusterSoldier = 0x10cf;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const phaseEndCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasEnvoyScript)("Lua real script Envoy of Chaos damage step end to-hand stat", () => {
  it("restores hand SelfDiscard damage-step stat swing and End Phase LIGHT/DARK banish recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectEnvoyScriptShape(workspace.readScript(`official/c${envoyCode}.lua`));
    const reader = createCardReader(cards());

    const damage = createRestoredDamageStep({ reader, workspace });
    expectCleanRestore(damage);
    expectRestoredLegalActions(damage, 0);
    const envoy = requireCard(damage.session, envoyCode);
    const gaia = requireCard(damage.session, gaiaCode);
    const target = requireCard(damage.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(damage, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === gaia.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(damage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(damage, attack!);
    advanceToQuickActivation(damage, envoy.uid);
    expect(["attackNegationResponse", "beforeDamageCalculation"]).toContain(damage.session.state.battleWindow?.kind);
    const quick = getLuaRestoreLegalActions(damage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === envoy.uid && action.effectId === "lua-1-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(damage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(damage, quick!);
    resolveRestoredChain(damage);

    expect(damage.session.state.cards.find((card) => card.uid === envoy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: envoy.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(damage.session.state.cards.find((card) => card.uid === gaia.uid), damage.session.state)).toBe(3800);
    expect(damage.session.state.effects.filter((effect) =>
      effect.sourceUid === gaia.uid && [effectUpdateAttack, effectSetAttackFinal].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: gaia.uid, targetRange: undefined, value: 1500 },
    ]);
    expect(damage.session.state.effects.filter((effect) =>
      effect.sourceUid === envoy.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1073742336 }, sourceUid: envoy.uid, targetRange: [0, 4], value: undefined },
    ]);
    expect(damage.session.state.eventHistory.filter((event) =>
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
      { eventCardUid: gaia.uid, eventCode: 1134, eventName: "beforeDamageCalculation", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: envoy.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: envoy.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: gaia.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const end = createRestoredEndPhase({ reader, workspace });
    expectCleanRestore(end);
    expectRestoredLegalActions(end, 0);
    const endEnvoy = requireCard(end.session, envoyCode);
    const lightCost = requireCard(end.session, lightCostCode);
    const darkCost = requireCard(end.session, darkCostCode);
    const endPhase = getLuaRestoreLegalActions(end, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(end, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(end, endPhase!);
    const endTrigger = restoreDuelWithLuaScripts(serializeDuel(end.session), workspace, reader);
    expectCleanRestore(endTrigger);
    expectRestoredLegalActions(endTrigger, 0);
    expect(endTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-4608", eventCode: phaseEndCode, eventName: "phaseEnd", player: 0, sourceUid: endEnvoy.uid, triggerBucket: "turnOptional" },
    ]);
    const recover = getLuaRestoreLegalActions(endTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === endEnvoy.uid && action.effectId === "lua-2-4608"
    );
    expect(recover, JSON.stringify({
      pendingTriggers: endTrigger.session.state.pendingTriggers,
      waitingFor: endTrigger.session.state.waitingFor,
      actions0: getLuaRestoreLegalActions(endTrigger, 0),
      actions1: getLuaRestoreLegalActions(endTrigger, 1),
    }, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(endTrigger, recover!);
    resolveRestoredChain(endTrigger);

    expect(endTrigger.session.state.cards.find((card) => card.uid === lightCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: endEnvoy.uid,
      reasonEffectId: 2,
    });
    expect(endTrigger.session.state.cards.find((card) => card.uid === darkCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: endEnvoy.uid,
      reasonEffectId: 2,
    });
    expect(endTrigger.session.state.cards.find((card) => card.uid === endEnvoy.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: endEnvoy.uid,
      reasonEffectId: 2,
    });
    expect(endTrigger.host.messages).toContain(`confirmed 1: ${envoyCode}`);
    const endEvents = endTrigger.session.state.eventHistory.filter((event) =>
      ["phaseEnd", "banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
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
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }));
    expect(endEvents).toContainEqual({ eventCardUid: undefined, eventCode: phaseEndCode, eventName: "phaseEnd", eventPlayer: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined, eventUids: undefined, eventValue: undefined, previous: undefined, current: undefined });
    expect(endEvents).toContainEqual({ eventCardUid: lightCost.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: endEnvoy.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, eventValue: undefined, previous: "graveyard", current: "banished" });
    expect(endEvents).toContainEqual({ eventCardUid: darkCost.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: endEnvoy.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, eventValue: undefined, previous: "graveyard", current: "banished" });
    expect(endEvents).toContainEqual({ eventCardUid: endEnvoy.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: endEnvoy.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, eventValue: undefined, previous: "graveyard", current: "hand" });
    expect(endEvents).toContainEqual({ eventCardUid: endEnvoy.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: endEnvoy.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: [endEnvoy.uid], eventValue: 1, previous: "graveyard", current: "hand" });
    expect(endEvents).toContainEqual({ eventCardUid: endEnvoy.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: endEnvoy.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: [endEnvoy.uid], eventValue: 1, previous: "graveyard", current: "hand" });
    expect(endTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDamageStep({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 38695361, reader, workspace, main0: [envoyCode, gaiaCode], main1: [battleTargetCode] });
  moveDuelCard(session.state, requireCard(session, envoyCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, gaiaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredEndPhase({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 38695362, reader, workspace, main0: [envoyCode, lightCostCode, darkCostCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, envoyCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, lightCostCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, darkCostCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main2";
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
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(envoyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: envoyCode, name: "Envoy of Chaos", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 0 },
    { code: gaiaCode, name: "Envoy of Chaos Gaia Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2300, defense: 2100, setcodes: [setGaiaFierceKnight] },
    { code: battleTargetCode, name: "Envoy of Chaos Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: lightCostCode, name: "Envoy of Chaos LIGHT Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1000, setcodes: [setBlackLusterSoldier] },
    { code: darkCostCode, name: "Envoy of Chaos DARK Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectEnvoyScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Envoy of Chaos");
  expect(script).toContain("s.listed_series={SET_BLACK_LUSTER_SOLDIER,SET_GAIA_THE_FIERCE_KNIGHT}");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(s.atkcon1)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("return Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard({SET_BLACK_LUSTER_SOLDIER,SET_GAIA_THE_FIERCE_KNIGHT})");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c,ATTRIBUTE_LIGHT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c,ATTRIBUTE_DARK)");
  expect(script).toContain("Duel.Remove(g1,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,c)");
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
