import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { canPlayerSpecialSummon, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeFusion, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragonarCode = "95134948";
const utopiaCode = "84013237";
const fusionProbeCode = "951349480";
const materialACode = "951349481";
const materialBCode = "951349482";
const opponentAttackerCode = "951349483";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDragonarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonarCode}.lua`));
const hasUtopiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${utopiaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setNumber = 0x48;
const effectCannotSpecialSummon = 22;
const effectCannotDirectAttack = 73;
const effectSetAttackFinal = 102;
const eventAttackAnnounce = 1130;
const resetPhaseEnd = 0x40000200;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDragonarScript || !hasUtopiaScript)("Lua real script Number 99 Utopia Dragonar detach Number summon attack zero lock", () => {
  it("restores detach cost Number Xyz summon locks and opponent attack ATK-zero trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonarCode}.lua`));
    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const dragonarData = databaseCards.find((card) => card.code === dragonarCode);
    const utopiaData = databaseCards.find((card) => card.code === utopiaCode);
    expect(dragonarData).toBeDefined();
    expect(utopiaData).toBeDefined();
    const reader = createCardReader([
      dragonarData!,
      utopiaData!,
      ...cards(),
    ]);

    const restoredSummon = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonDragonar = requireCard(restoredSummon.session, dragonarCode);
    const utopia = requireCard(restoredSummon.session, utopiaCode);
    const materialA = requireCard(restoredSummon.session, materialACode);
    const materialB = requireCard(restoredSummon.session, materialBCode);
    const fusionProbe = requireCard(restoredSummon.session, fusionProbeCode);
    expect(summonDragonar.data.xyzMaterialMax).toBe(99);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonDragonar.uid && action.effectId === "lua-2-1002"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonDragonar.uid)?.overlayUids).toEqual([]);
    for (const material of [materialA, materialB]) {
      expect(restoredSummon.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: summonDragonar.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredSummon.session.state.cards.find((card) => card.uid === utopia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "xyz",
      summonTypeCode: luaSummonTypeXyz,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonDragonar.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.effects.filter((effect) =>
      effect.controller === 0 && [effectCannotDirectAttack, effectCannotSpecialSummon].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotDirectAttack, event: "continuous", property: 0x80080, registryKey: `lua:${dragonarCode}:lua-8-73`, reset: { flags: resetPhaseEnd }, targetRange: [4, 0] },
      { code: effectCannotSpecialSummon, event: "continuous", property: 0x4080800, registryKey: `lua:${dragonarCode}:lua-9-22`, reset: { flags: resetPhaseEnd }, targetRange: [1, 0] },
    ]);
    expect(canPlayerSpecialSummon(restoredSummon.session.state, 0, restoredSummon.session.state.cards.find((card) => card.uid === utopia.uid)!, luaSummonTypeXyz)).toBe(true);
    expect(canPlayerSpecialSummon(restoredSummon.session.state, 0, restoredSummon.session.state.cards.find((card) => card.uid === fusionProbe.uid)!, luaSummonTypeFusion)).toBe(false);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["detachedMaterial", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonDragonar.uid, eventReasonEffectId: 2, eventUids: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCardUid: materialB.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonDragonar.uid, eventReasonEffectId: 2, eventUids: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonDragonar.uid, eventReasonEffectId: 2, eventUids: [materialA.uid, materialB.uid], previous: "overlay", current: "graveyard" },
      { eventName: "specialSummoned", eventCardUid: utopia.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonDragonar.uid, eventReasonEffectId: 2, eventUids: [utopia.uid], previous: "extraDeck", current: "monsterZone" },
    ]);
    const restoredSummonPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredSummonPersistent);
    expectRestoredLegalActions(restoredSummonPersistent, 0);
    expect(canPlayerSpecialSummon(restoredSummonPersistent.session.state, 0, restoredSummonPersistent.session.state.cards.find((card) => card.uid === fusionProbe.uid)!, luaSummonTypeFusion)).toBe(false);

    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const attackDragonar = requireCard(restoredAttack.session, dragonarCode);
    const opponentAttacker = requireCard(restoredAttack.session, opponentAttackerCode);
    const attack = getLuaRestoreLegalActions(restoredAttack, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && action.targetUid === attackDragonar.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);
    const trigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === attackDragonar.uid && action.effectId === "lua-3-1130"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trigger!);
    resolveRestoredChain(restoredAttack);
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === opponentAttacker.uid), restoredAttack.session.state)).toBe(0);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === opponentAttacker.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: 0x400, registryKey: `lua:${dragonarCode}:lua-5-102`, reset: { flags: resetEventStandard }, sourceUid: opponentAttacker.uid, value: 0 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: opponentAttacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", relatedEffectId: undefined },
    ]);
    const restoredAttackPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackPersistent);
    expectRestoredLegalActions(restoredAttackPersistent, 0);
    expect(restoredAttackPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(currentAttack(restoredAttackPersistent.session.state.cards.find((card) => card.uid === opponentAttacker.uid), restoredAttackPersistent.session.state)).toBe(0);
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 95134948, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [dragonarCode, utopiaCode, fusionProbeCode] }, 1: { main: [] } });
  startDuel(session);
  const dragonar = requireCard(session, dragonarCode);
  const materialA = requireCard(session, materialACode);
  const materialB = requireCard(session, materialBCode);
  moveFaceUpAttack(session, dragonar, 0, 0);
  dragonar.summonType = "xyz";
  dragonar.summonTypeCode = luaSummonTypeXyz;
  moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  dragonar.overlayUids.push(materialA.uid, materialB.uid);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonarCode), workspace).ok).toBe(true);
  expect(host.loadCardScript(Number(utopiaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 95134949, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [dragonarCode] }, 1: { main: [opponentAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dragonarCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentAttackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonarCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number 99: Utopia Dragonar");
  expect(script).toContain("Xyz.AddProcedure(c,nil,12,3,nil,nil,Xyz.InfiniteMats)");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(2),s.spcost))");
  expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("aux.addTempLizardCheck(c,tp,function(e,c) return not c:IsOriginalType(TYPE_XYZ) end)");
  expect(script).toContain("return c:IsSetCard(SET_NUMBER) and c.xyz_number and c.xyz_number>=1 and c.xyz_number<=100 and Duel.GetLocationCountFromEx(tp,tp,nil,c)>0");
  expect(script).toContain("Duel.SpecialSummon(sc,SUMMON_TYPE_XYZ,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e:SetLabelObject(bc)");
  expect(script).toContain("bc:CreateEffectRelation(e)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
}

function cards(): DuelCardData[] {
  return [
    { code: fusionProbeCode, name: "Utopia Dragonar Fusion Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: materialACode, name: "Utopia Dragonar Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 12, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Utopia Dragonar Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 12, attack: 1000, defense: 1000 },
    { code: opponentAttackerCode, name: "Utopia Dragonar Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 2600, defense: 1200 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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
