import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const samuraiCode = "35818851";
const zombieCostCode = "358188510";
const battleTargetCode = "358188511";
const recoveryTargetCode = "358188512";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSamuraiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${samuraiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const setShiranui = 0xd9;
const effectUpdateAttack = 100;
const eventBattled = 1138;

describe.skipIf(!hasUpstreamScripts || !hasSamuraiScript)("Lua real script Shiranui Samurai banish battled to-hand stat", () => {
  it("restores Zombie banish-cost ATK gain, battled monster banish, and self-banished Shiranui recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${samuraiCode}.lua`));
    const reader = createCardReader(cards());

    const restoredBoost = createRestoredSamuraiField({ reader, workspace });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const samurai = requireCard(restoredBoost.session, samuraiCode);
    const zombieCost = requireCard(restoredBoost.session, zombieCostCode);
    const battleTarget = requireCard(restoredBoost.session, battleTargetCode);

    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "activateEffect" && action.uid === samurai.uid && action.effectId === "lua-1-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === zombieCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: samurai.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === samurai.uid), restoredBoost.session.state)).toBe(2400);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === samurai.uid && [effectUpdateAttack, eventBattled].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: samurai.uid, value: 600 },
      { code: eventBattled, reset: { flags: 1107169792 }, sourceUid: samurai.uid, value: undefined },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === zombieCost.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "banished",
        eventCardUid: zombieCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: samurai.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBoost, 0);
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === samurai.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);
    finishBattle(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: samurai.uid,
      reasonEffectId: 4,
    });
    expect(restoredBoost.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toContainEqual({
      eventName: "banished",
      eventCode: 1011,
      eventCardUid: battleTarget.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: samurai.uid,
      eventReasonEffectId: 4,
    });
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });

    const restoredBanish = createRestoredSamuraiField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    const banishedSamurai = requireCard(restoredBanish.session, samuraiCode);
    const recoveryTarget = requireCard(restoredBanish.session, recoveryTargetCode);
    banishDuelCard(restoredBanish.session.state, banishedSamurai.uid, 0, duelReason.effect, 0);
    expect(restoredBanish.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1011", eventCardUid: banishedSamurai.uid, eventName: "banished", eventReason: duelReason.effect, player: 0, sourceUid: banishedSamurai.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredRecovery = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredRecovery);
    expectRestoredLegalActions(restoredRecovery, 0);
    const recovery = getLuaRestoreLegalActions(restoredRecovery, 0).find((action) => action.type === "activateTrigger" && action.uid === banishedSamurai.uid && action.effectId === "lua-2-1011");
    expect(recovery, JSON.stringify(getLuaRestoreLegalActions(restoredRecovery, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecovery, recovery!);
    resolveRestoredChain(restoredRecovery);

    expect(restoredRecovery.session.state.cards.find((card) => card.uid === recoveryTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: banishedSamurai.uid,
      reasonEffectId: 2,
    });
    expect(restoredRecovery.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "banished", eventCardUid: banishedSamurai.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCardUid: recoveryTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "sentToHand", eventCardUid: recoveryTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: banishedSamurai.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
    expect(restoredRecovery.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Shiranui Samurai");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(600)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: samuraiCode, name: "Shiranui Samurai", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1800, defense: 0, setcodes: [setShiranui] },
    { code: zombieCostCode, name: "Shiranui Samurai Zombie Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: battleTargetCode, name: "Shiranui Samurai Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
    { code: recoveryTargetCode, name: "Shiranui Samurai Recovery Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1200, defense: 1000, setcodes: [setShiranui] },
  ];
}

function createRestoredSamuraiField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 35818851, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [samuraiCode, zombieCostCode, recoveryTargetCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, samuraiCode), 0);
  moveDuelCard(session.state, requireCard(session, zombieCostCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, recoveryTargetCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(samuraiCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
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
