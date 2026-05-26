import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const heartsCode = "21848500";
const banishedMalissCode = "218485001";
const linkedMalissCode = "218485002";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHeartsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heartsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setMaliss = 0x1b9;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const effectSetAttack = 101;

describe.skipIf(!hasUpstreamScripts || !hasHeartsScript)("Lua real script Maliss Hearts Crypter to-deck banish summon stat", () => {
  it("restores banished Maliss shuffle into on-field banish and banished-trigger LP summon ATK set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${heartsCode}.lua`);
    expectHeartsScriptShape(script);
    const reader = createCardReader(cards());

    const restoredQuick = createRestoredHeartsField({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickHearts = requireCard(restoredQuick.session, heartsCode);
    const banishedMaliss = requireCard(restoredQuick.session, banishedMalissCode);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === quickHearts.uid && [12, 13].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 12, sourceUid: quickHearts.uid },
      { code: 13, sourceUid: quickHearts.uid },
    ]);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === quickHearts.uid && action.effectId === "lua-2-1002");
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === banishedMaliss.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: quickHearts.uid,
      reasonEffectId: 2,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickHearts.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: quickHearts.uid,
      reasonEffectId: 2,
    });
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["becameTarget", "sentToDeck", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: banishedMaliss.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "banished" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: banishedMaliss.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: quickHearts.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "banished", current: "deck" },
      { eventName: "banished", eventCode: 1011, eventCardUid: quickHearts.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: quickHearts.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
    ]);

    const restoredBanish = createRestoredHeartsField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    const triggerHearts = requireCard(restoredBanish.session, heartsCode);
    banishDuelCard(restoredBanish.session.state, triggerHearts.uid, 0, duelReason.effect, 0);
    expect(restoredBanish.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1011", eventCardUid: triggerHearts.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, player: 0, sourceUid: triggerHearts.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerHearts.uid && action.effectId === "lua-5-1011");
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(7100);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === triggerHearts.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: triggerHearts.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === triggerHearts.uid), restoredTrigger.session.state)).toBe(5000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === triggerHearts.uid && effect.code === effectSetAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttack, reset: { flags: 33492992 }, sourceUid: triggerHearts.uid, value: 5000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "lifePointCostPaid", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: triggerHearts.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 900, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: triggerHearts.uid, eventReasonEffectId: 5, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: triggerHearts.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: triggerHearts.uid, eventReasonEffectId: 5, previous: "banished", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredHeartsField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 21848500, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [banishedMalissCode, linkedMalissCode], extra: [heartsCode] }, 1: { main: [] } });
  startDuel(session);
  const hearts = requireCard(session, heartsCode);
  moveFaceUpAttack(session, hearts, 0, 2);
  hearts.summonType = "link";
  hearts.customStatusMask = statusProcComplete;
  moveFaceUpAttack(session, requireCard(session, linkedMalissCode), 0, 3);
  const banishedMaliss = moveDuelCard(session.state, requireCard(session, banishedMalissCode).uid, "banished", 0);
  banishedMaliss.faceUp = true;
  banishedMaliss.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(heartsCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectHeartsScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,nil,3,3,s.lcheck)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return c:IsSetCard(SET_MALISS) and c:IsFaceup() and c:IsAbleToDeck()");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_REMOVED,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("ge1:SetCode(EFFECT_CANNOT_INACTIVATE)");
  expect(script).toContain("ge2:SetCode(EFFECT_CANNOT_DISEFFECT)");
  expect(script).toContain("Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)");
  expect(script).toContain("te:GetHandler():GetLinkedGroupCount()>0");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(900))");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: heartsCode, name: "Maliss <Q> Hearts Crypter", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setMaliss], race: raceCyberse, attribute: attributeDark, level: 3, attack: 2500, defense: 0, linkMarkers: 0x20, linkMaterialMin: 3, linkMaterialMax: 3 },
    { code: banishedMalissCode, name: "Hearts Crypter Banished Maliss", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMaliss], race: raceCyberse, attribute: attributeDark, level: 3, attack: 1200, defense: 1000 },
    { code: linkedMalissCode, name: "Hearts Crypter Linked Maliss", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMaliss], race: raceCyberse, attribute: attributeDark, level: 3, attack: 1500, defense: 1000 },
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
