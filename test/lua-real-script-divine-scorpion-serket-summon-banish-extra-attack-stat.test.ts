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
const serketCode = "23804920";
const banishTargetCode = "238049200";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSerketScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${serketCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceBeast = 0x4;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const summonTypeFusion = 0x43000000;
const effectExtraAttack = 194;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSerketScript)("Lua real script Divine Scorpion Serket summon banish extra attack stat", () => {
  it("restores Special Summon target banish into half-base ATK gain and conditional extra direct attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${serketCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredSerketField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const serket = requireCard(restoredOpen.session, serketCode);
    const target = requireCard(restoredOpen.session, banishTargetCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === serket.uid && effect.code === effectExtraAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttack, event: "continuous", range: ["extraDeck"], sourceUid: serket.uid, value: 1 },
    ]);

    specialSummonDuelCard(restoredOpen.session.state, serket.uid, 0, 0, {}, summonTypeFusion, true, false);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === serket.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: serket.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: serket.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === serket.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    if (!trigger || trigger.type !== "activateTrigger") throw new Error("Expected Divine Scorpion Serket summon trigger");
    const effectNumericId = Number(trigger.effectId.split("-")[1]);
    applyRestoredActionAndAssert(restoredTrigger, trigger);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: serket.uid,
      reasonEffectId: effectNumericId,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === serket.uid)).toMatchObject({
      attackModifier: 1300,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === serket.uid), restoredTrigger.session.state)).toBe(4300);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: serket.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: effectNumericId },
      { eventCardUid: target.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: serket.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);

    restoredTrigger.session.state.phase = "battle";
    restoredTrigger.session.state.turnPlayer = 0;
    restoredTrigger.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const directAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === serket.uid && action.directAttack === true
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    finishBattle(restoredBattle);

    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 4300 });
    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    restoredSecondAttack.session.state.phase = "battle";
    restoredSecondAttack.session.state.waitingFor = 0;
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    expect(secondActions.some((action) =>
      action.type === "declareAttack" && action.attackerUid === serket.uid && action.directAttack === true
    )).toBe(true);
  });
});

function createRestoredSerketField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 23804920, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [serketCode] }, 1: { main: [banishTargetCode] } });
  startDuel(session);
  moveFaceUpGrave(session, requireCard(session, banishTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(serketCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Divine Scorpion Beast of Serket");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_SERKET),aux.FilterBoolFunction(Card.IsAttackBelow,2500))");
  expect(script).toContain("CATEGORY_REMOVE+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O");
  expect(script).toContain("EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET");
  expect(script).toContain("EVENT_SPSUMMON_SUCCESS");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("return bc and bc:IsControler(1-tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.rmfilter,tp,0,LOCATION_MZONE|LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,tp,0)");
  expect(script).toContain("local atk=tc:GetBaseAttack()/2");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("c:UpdateAttack(atk)");
  expect(script).toContain("EFFECT_EXTRA_ATTACK");
  expect(script).toContain("aux.FaceupFilter(Card.IsLevelAbove,10)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const serket = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === serketCode);
  expect(serket).toBeDefined();
  return [
    { ...serket!, kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeast, attribute: attributeEarth },
    { code: banishTargetCode, name: "Divine Scorpion Level 10 Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 10, attack: 2600, defense: 2000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
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
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
