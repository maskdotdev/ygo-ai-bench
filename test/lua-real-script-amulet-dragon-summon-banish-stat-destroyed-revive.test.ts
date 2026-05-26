import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const amuletCode = "75380687";
const ownSpellCode = "753806870";
const opponentSpellCode = "753806871";
const spellcasterCode = "753806872";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAmuletScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${amuletCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const summonTypeFusion = 0x43000000;
const effectSpecialSummonCondition = 30;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasAmuletScript)("Lua real script Amulet Dragon summon banish stat destroyed revive", () => {
  it("restores Special Summon Spell banish ATK gain and destroyed Spellcaster revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${amuletCode}.lua`));
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredAmuletField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const amulet = requireCard(restoredOpen.session, amuletCode);
    const ownSpell = requireCard(restoredOpen.session, ownSpellCode);
    const opponentSpell = requireCard(restoredOpen.session, opponentSpellCode);
    const spellcaster = requireCard(restoredOpen.session, spellcasterCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === amulet.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { code: 31, event: "continuous", property: 263168, range: ["extraDeck"] },
      { code: effectSpecialSummonCondition, event: "continuous", property: 263168, range: ["extraDeck"] },
      { code: 1102, event: "trigger", property: 16, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { code: 1029, event: "trigger", property: 81936, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    specialSummonDuelCard(restoredOpen.session.state, amulet.uid, 0, 0, {}, summonTypeFusion, true, false);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === amulet.uid)).toMatchObject({
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
      { effectId: "lua-3-1102", eventCardUid: amulet.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: amulet.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const banish = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === amulet.uid);
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, banish!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: amulet.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: amulet.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredSummonTrigger.session.state.cards.find((card) => card.uid === amulet.uid), restoredSummonTrigger.session.state)).toBe(3100);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === amulet.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: amulet.uid, value: 200 },
    ]);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: amulet.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: amulet.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: amulet.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: amulet.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
    ]);

    destroyDuelCard(restoredSummonTrigger.session.state, amulet.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-4-1029", eventCardUid: amulet.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: amulet.uid, triggerBucket: "turnOptional" },
    ]);
    const revive = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === amulet.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, revive!);
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === spellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: amulet.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === amulet.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: amulet.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: amulet.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellcaster.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: spellcaster.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: amulet.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAmuletField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 75380687, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ownSpellCode, spellcasterCode], extra: [amuletCode] }, 1: { main: [opponentSpellCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ownSpellCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, spellcasterCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, opponentSpellCode).uid, "graveyard", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(amuletCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Amulet Dragon");
  expect(script).toContain("Fusion.AddProcMix(c,false,false,CARD_DARK_MAGICIAN,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON))");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("return (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION or se:GetHandler():IsCode(1784686)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSpell() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,LOCATION_GRAVE,1,120,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*100)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return c:IsRace(RACE_SPELLCASTER) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: amuletCode, name: "Amulet Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, attribute: attributeDark, level: 8, attack: 2900, defense: 2500 },
    { code: ownSpellCode, name: "Amulet Dragon Own Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentSpellCode, name: "Amulet Dragon Opponent Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: spellcasterCode, name: "Amulet Dragon Spellcaster Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
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
