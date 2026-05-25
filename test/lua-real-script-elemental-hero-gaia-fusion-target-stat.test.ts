import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gaiaCode = "16304628";
const heroMaterialCode = "163046280";
const earthMaterialCode = "163046281";
const ownMonsterCode = "163046282";
const opponentTargetCode = "163046283";
const opponentDecoyCode = "163046284";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaiaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const setElementalHero = 0x3008;
const effectSpecialSummonCondition = 30;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const effectFlagCardTarget = 0x10;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasGaiaScript)("Lua real script Elemental HERO Gaia Fusion target stat", () => {
  it("restores Fusion.AddProcMix predicates into fusion-summoned targeted ATK halving and self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gaiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 16304628, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [heroMaterialCode, earthMaterialCode, ownMonsterCode], extra: [gaiaCode] },
      1: { main: [opponentTargetCode, opponentDecoyCode] },
    });
    startDuel(session);

    const gaia = requireCard(session, gaiaCode);
    const heroMaterial = requireCard(session, heroMaterialCode);
    const earthMaterial = requireCard(session, earthMaterialCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const opponentDecoy = requireCard(session, opponentDecoyCode);
    moveDuelCard(session.state, heroMaterial.uid, "hand", 0);
    moveDuelCard(session.state, earthMaterial.uid, "hand", 0);
    moveFaceUpAttack(session, ownMonster, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveFaceUpAttack(session, opponentDecoy, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gaiaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(gaia.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setElementalHero }, { attribute: attributeEarth }]);

    expect(session.state.effects.filter((effect) => effect.sourceUid === gaia.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, sourceUid: gaia.uid },
      { category: 2097152, code: 1102, event: "trigger", property: effectFlagCardTarget, sourceUid: gaia.uid },
      { category: undefined, code: effectSpecialSummonCondition, event: "continuous", property: 263168, sourceUid: gaia.uid },
    ]);

    const fusionSummon = getLegalActions(session, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === gaia.uid && sameMembers(action.materialUids, [heroMaterial.uid, earthMaterial.uid])
    );
    expect(fusionSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, fusionSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === gaia.uid)?.data.fusionRequiredMaterialPredicates).toEqual([
      { setcode: setElementalHero },
      { attribute: attributeEarth },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === gaia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [heroMaterial.uid, earthMaterial.uid],
    });
    for (const material of [heroMaterial, earthMaterial]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.material | duelReason.fusion,
      });
    }
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: gaia.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gaia.uid,
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === gaia.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === gaia.uid), restoredTrigger.session.state)).toBe(3300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownMonster.uid), restoredTrigger.session.state)).toBe(1700);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredTrigger.session.state)).toBe(1100);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentDecoy.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.effects.filter((effect) => [gaia.uid, opponentTarget.uid, opponentDecoy.uid].includes(effect.sourceUid) && [effectUpdateAttack, effectSetAttackFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentTarget.uid, value: 1100 },
      { code: effectUpdateAttack, property: 1024, reset: { flags: resetStandardPhaseEnd }, sourceUid: gaia.uid, value: 1100 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventCardUid: gaia.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
      },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === gaia.uid), restoredAfter.session.state)).toBe(3300);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredAfter.session.state)).toBe(1100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Elemental HERO Gaia");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_ELEMENTAL_HERO),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_EARTH))");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(atk/2)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetValue(atk/2)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e3:SetValue(aux.fuslimit)");
}

function cards(): DuelCardData[] {
  return [
    { code: gaiaCode, name: "Elemental HERO Gaia", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 2600 },
    { code: heroMaterialCode, name: "Gaia Elemental HERO Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1200, setcodes: [setElementalHero] },
    { code: earthMaterialCode, name: "Gaia EARTH Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
    { code: ownMonsterCode, name: "Gaia Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    { code: opponentTargetCode, name: "Gaia Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2200, defense: 1000 },
    { code: opponentDecoyCode, name: "Gaia Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
