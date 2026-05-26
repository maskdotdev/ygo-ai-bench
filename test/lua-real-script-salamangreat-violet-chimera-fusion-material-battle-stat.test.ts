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
const chimeraCode = "37261776";
const salamangreatMaterialCode = "372617760";
const linkMaterialCode = "372617761";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChimeraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chimeraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeFire = 0x4;
const setSalamangreat = 0x119;
const effectMaterialCheck = 251;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const effectSetAttack = 101;
const effectFlagDelay = 0x10000;
const effectFlagSingleRange = 0x20000;
const resetStandardDisablePhaseEnd = 0x41ff1200;

describe.skipIf(!hasUpstreamScripts || !hasChimeraScript)("Lua real script Salamangreat Violet Chimera fusion material battle stat", () => {
  it("restores Fusion material ATK label into summon ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${chimeraCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 37261776, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [salamangreatMaterialCode], extra: [chimeraCode, linkMaterialCode] }, 1: { main: [] } });
    startDuel(session);

    const chimera = requireCard(session, chimeraCode);
    const salamangreatMaterial = requireCard(session, salamangreatMaterialCode);
    const linkMaterial = requireCard(session, linkMaterialCode);
    moveFaceUpAttack(session, salamangreatMaterial, 0, 0);
    moveFaceUpAttack(session, linkMaterial, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chimeraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(chimera.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setSalamangreat }, { type: typeLink }]);
    expect(chimera.data.fusionMaterials).toBeUndefined();
    expect(session.state.effects.filter((effect) => effect.sourceUid === chimera.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["extraDeck"] },
      { category: 0x200000, code: 1102, event: "trigger", id: "lua-4-1102", property: effectFlagDelay, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: undefined, code: effectMaterialCheck, event: "continuous", id: "lua-5-251", property: undefined, range: ["extraDeck"] },
      { category: 0x200000, code: 1134, event: "quick", id: "lua-6-1134", property: undefined, range: ["monsterZone"] },
      { category: undefined, code: effectSetAttack, event: "continuous", id: "lua-7-101", property: undefined, range: ["monsterZone"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const fusionSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === chimera.uid && sameMembers(action.materialUids, [salamangreatMaterial.uid, linkMaterial.uid]));
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, fusionSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === chimera.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "fusion",
      summonMaterialUids: [salamangreatMaterial.uid, linkMaterial.uid],
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-4-1102",
        sourceUid: chimera.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: chimera.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === chimera.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === chimera.uid), restoredTrigger.session.state)).toBe(4400);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === chimera.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagSingleRange, range: ["monsterZone"], reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: chimera.uid, value: 1600 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: salamangreatMaterial.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: chimera.uid, eventReasonEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: linkMaterial.uid, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: chimera.uid, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: chimera.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === chimera.uid), restoredAfter.session.state)).toBe(4400);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Salamangreat Violet Chimera");
  expect(script).toContain("aux.EnableCheckReincarnation(c)");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_SALAMANGREAT),aux.FilterBoolFunctionEx(Card.IsType,TYPE_LINK))");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("local g=c:GetMaterial()");
  expect(script).toContain("if #g>0 then atk=g:GetSum(Card.GetBaseAttack) end");
  expect(script).toContain("e:GetLabelObject():SetLabel(atk)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,e:GetLabel()/2)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()/2)");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e4:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("return c:IsReincarnationSummoned() and c:IsFusionSummoned() and Duel.IsPhase(PHASE_DAMAGE_CAL)");
}

function cards(): DuelCardData[] {
  return [
    { code: chimeraCode, name: "Salamangreat Violet Chimera", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceCyberse, attribute: attributeFire, level: 8, attack: 2800, defense: 2000, setcodes: [setSalamangreat] },
    { code: salamangreatMaterialCode, name: "Violet Chimera Salamangreat Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1400, defense: 1000, setcodes: [setSalamangreat] },
    { code: linkMaterialCode, name: "Violet Chimera Link Material", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeFire, level: 2, attack: 1800, defense: 0, linkMarkers: 0x28 },
  ];
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
