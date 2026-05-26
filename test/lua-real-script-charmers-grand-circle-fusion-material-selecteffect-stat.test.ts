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
const grandCircleCode = "48016074";
const materialEarthCode = "480160740";
const materialWaterCode = "480160741";
const materialFireCode = "480160742";
const materialWindCode = "480160743";
const possessedSpellCode = "480160744";
const graveSpellcasterCode = "480160745";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGrandCircleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${grandCircleCode}.lua`));
const setCharmer = 0xbf;
const setPossessed = 0xc0;
const setFamiliarPossessed = 0x10c0;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const attributeWater = 0x2;
const attributeFire = 0x4;
const attributeWind = 0x8;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasGrandCircleScript)("Lua real script Charmers Grand Circle fusion material SelectEffect stat", () => {
  it("restores AddProcMixRep setcode-table Fusion metadata, material Attribute count, and repeated SelectEffect branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${grandCircleCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredGrandCircleField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const grandCircle = requireCard(restoredOpen.session, grandCircleCode);
    const materialEarth = requireCard(restoredOpen.session, materialEarthCode);
    const materialWater = requireCard(restoredOpen.session, materialWaterCode);
    const materialFire = requireCard(restoredOpen.session, materialFireCode);
    const materialWind = requireCard(restoredOpen.session, materialWindCode);
    const possessedSpell = requireCard(restoredOpen.session, possessedSpellCode);
    const graveSpellcaster = requireCard(restoredOpen.session, graveSpellcasterCode);
    expect(grandCircle.data).toMatchObject({
      fusionMaterialMin: 2,
      fusionMaterialMax: 99,
      fusionMaterialSetcodes: [setCharmer, setFamiliarPossessed],
    });

    const fusionSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === grandCircle.uid && sameMembers(action.materialUids, [materialEarth.uid, materialWater.uid, materialFire.uid, materialWind.uid])
    );
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, fusionSummon!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === grandCircle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialEarth.uid, materialWater.uid, materialFire.uid, materialWind.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: grandCircle.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, player: 0, sourceUid: grandCircle.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, {
      promptOverrides: [
        { api: "SelectEffect", player: 0, returned: 1 },
        { api: "SelectEffect", player: 0, returned: 2 },
        { api: "SelectEffect", player: 0, returned: 4 },
        { api: "SelectEffect", player: 0, returned: 5 },
      ],
    });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === grandCircle.uid && action.effectId === "lua-3-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([
      { api: "SelectEffect", player: 0, returned: 1 },
      { api: "SelectEffect", player: 0, returned: 2 },
      { api: "SelectEffect", player: 0, returned: 4 },
      { api: "SelectEffect", player: 0, returned: 5 },
    ]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === grandCircle.uid), restoredTrigger.session.state)).toBe(2800);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === possessedSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: grandCircle.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveSpellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: grandCircle.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === grandCircle.uid)).toMatchObject({ attackModifier: 800 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "sentToHand", "confirmed", "sentToHandConfirmed", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventCardUid: materialEarth.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.fusion, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
      { eventCardUid: materialWater.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.fusion, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
      { eventCardUid: materialFire.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.fusion, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
      { eventCardUid: materialWind.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.fusion, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "hand", current: "graveyard" },
      { eventCardUid: grandCircle.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: possessedSpell.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: possessedSpell.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: possessedSpell.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: graveSpellcaster.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: grandCircle.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredGrandCircleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 48016074, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialEarthCode, materialWaterCode, materialFireCode, materialWindCode, possessedSpellCode, graveSpellcasterCode], extra: [grandCircleCode] }, 1: { main: [] } });
  startDuel(session);
  for (const code of [materialEarthCode, materialWaterCode, materialFireCode, materialWindCode]) moveDuelCard(session.state, requireCard(session, code).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, graveSpellcasterCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(grandCircleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Charmers of the Grand Circle");
  expect(script).toContain("Fusion.AddProcMixRep(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,{SET_CHARMER,SET_FAMILIAR_POSSESSED}),2,99)");
  expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e0:SetValue(function(e,c) e:SetLabel(c:GetMaterial():GetClassCount(Card.GetOriginalAttribute)) end)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("Duel.SetTargetParam(label)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,800)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("return c:IsSetCard(SET_POSSESSED) and c:IsSpellTrap() and c:IsAbleToHand()");
  expect(script).toContain("return c:IsRace(RACE_SPELLCASTER) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("math.min(Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM),4)");
  expect(script).toContain("op=Duel.SelectEffect(tp,");
  expect(script).toContain("c:UpdateAttack(800)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: grandCircleCode, name: "Charmers of the Grand Circle", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2000, defense: 2800 },
    { code: materialEarthCode, name: "Grand Circle EARTH Charmer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 1500, defense: 1500, setcodes: [setCharmer] },
    { code: materialWaterCode, name: "Grand Circle WATER Familiar-Possessed", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWater, level: 4, attack: 1850, defense: 1500, setcodes: [setFamiliarPossessed] },
    { code: materialFireCode, name: "Grand Circle FIRE Charmer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeFire, level: 4, attack: 1500, defense: 1500, setcodes: [setCharmer] },
    { code: materialWindCode, name: "Grand Circle WIND Familiar-Possessed", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1850, defense: 1500, setcodes: [setFamiliarPossessed] },
    { code: possessedSpellCode, name: "Grand Circle Possessed Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setPossessed] },
    { code: graveSpellcasterCode, name: "Grand Circle Grave Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
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
