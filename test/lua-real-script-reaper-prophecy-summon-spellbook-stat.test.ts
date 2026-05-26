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
const reaperCode = "9560338";
const graveSpellbookCodes = ["95603380", "95603381", "95603382", "95603383", "95603384"];
const searchSpellbookCode = "95603385";
const summonSpellcasterCode = "95603386";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasReaperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reaperCode}.lua`));
const setSpellbook = 0x106e;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasReaperScript)("Lua real script Reaper of Prophecy summon Spellbook stat", () => {
  it("restores unique Spellbook grave count into ATK gain, BreakEffect search, and Deck Spellcaster summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${reaperCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredReaperField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const reaper = requireCard(restoredOpen.session, reaperCode);
    const searchSpellbook = requireCard(restoredOpen.session, searchSpellbookCode);
    const summonSpellcaster = requireCard(restoredOpen.session, summonSpellcasterCode);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === reaper.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, normalSummon!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === reaper.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
      reason: duelReason.summon,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: reaper.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: reaper.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === reaper.uid && action.effectId === "lua-1-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === reaper.uid), restoredTrigger.session.state)).toBe(2600);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === reaper.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33492992 }, sourceUid: reaper.uid, value: 600 },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === searchSpellbook.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: reaper.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summonSpellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reaper.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      ["breakEffect", "sentToHand", "confirmed", "sentToHandConfirmed", "specialSummoned"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: undefined, previous: undefined, current: undefined },
      { eventCardUid: searchSpellbook.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: undefined, previous: "deck", current: "hand" },
      { eventCardUid: searchSpellbook.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 1, previous: "deck", current: "hand" },
      { eventCardUid: searchSpellbook.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 1, previous: "deck", current: "hand" },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: undefined, previous: undefined, current: undefined },
      { eventCardUid: summonSpellcaster.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: reaper.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: undefined, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredReaperField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 9560338, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reaperCode, ...graveSpellbookCodes, searchSpellbookCode, summonSpellcasterCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, reaperCode).uid, "hand", 0);
  for (const code of graveSpellbookCodes) moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(reaperCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Reaper of Prophecy");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_SPELLBOOK) and c:IsSpell()");
  expect(script).toContain("g:GetClassCount(Card.GetCode)>=3");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("ct=g:GetClassCount(Card.GetCode)");
  expect(script).toContain("if ct<=2 then return end");
  expect(script).toContain("if ct>=3 and c:IsFaceup() and c:IsRelateToEffect(e) then");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(600)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("if break_chk then Duel.BreakEffect() end");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("ct>=5 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("return c:IsRace(RACE_SPELLCASTER) and c:IsAttribute(ATTRIBUTE_DARK) and c:IsLevelAbove(5)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: reaperCode, name: "Reaper of Prophecy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 2000, defense: 1600 },
    ...graveSpellbookCodes.map((code, index) => ({ code, name: `Reaper Grave Spellbook ${index + 1}`, kind: "spell" as const, typeFlags: typeSpell, setcodes: [setSpellbook] })),
    { code: searchSpellbookCode, name: "Reaper Search Spellbook", kind: "spell", typeFlags: typeSpell, setcodes: [setSpellbook] },
    { code: summonSpellcasterCode, name: "Reaper Deck Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 6, attack: 2400, defense: 1200 },
  ];
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
