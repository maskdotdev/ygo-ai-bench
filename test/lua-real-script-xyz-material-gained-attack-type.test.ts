import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel, xyzSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import type { UpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createDuel } from "#duel/core.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const extraSwordCode = "34143852";
const trolleyOlleyCode = "7080743";
const hasExtraSwordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${extraSwordCode}.lua`));
const hasTrolleyOlleyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${trolleyOlleyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const effectUpdateAttack = 100;
const effectAddType = 115;
const eventBeMaterial = 1108;
const eventSpecialSummonSuccess = 1102;

type MaterialGainCase = {
  materialCode: string;
  materialName: string;
  boost: number;
  stringId: number;
  valueSnippet: string;
};

describe.skipIf(!hasUpstreamScripts || !hasExtraSwordScript || !hasTrolleyOlleyScript)("Lua real script Xyz material gained attack and type", () => {
  it("restores official REASON_XYZ material grants into Xyz-summon trigger ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cases: MaterialGainCase[] = [
      {
        materialCode: extraSwordCode,
        materialName: "Heroic Challenger - Extra Sword",
        boost: 1000,
        stringId: Number(extraSwordCode) * 16,
        valueSnippet: "e1:SetValue(1000)",
      },
      {
        materialCode: trolleyOlleyCode,
        materialName: "Express Train Trolley Olley",
        boost: 800,
        stringId: Number(trolleyOlleyCode) * 16,
        valueSnippet: "e1:SetValue(800)",
      },
    ];

    for (const testCase of cases) {
      assertOfficialMaterialGrantScript(workspace, testCase);
      assertXyzMaterialGrant(workspace, testCase);
    }
  });
});

function assertOfficialMaterialGrantScript(workspace: UpstreamNodeWorkspace, testCase: MaterialGainCase): void {
  const script = workspace.readScript(`c${testCase.materialCode}.lua`);
  expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return r==REASON_XYZ");
  expect(script).toContain("local rc=c:GetReasonCard()");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e2:SetValue(TYPE_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain(testCase.valueSnippet);
}

function assertXyzMaterialGrant(workspace: UpstreamNodeWorkspace, testCase: MaterialGainCase): void {
  const normalXyzCode = `${testCase.materialCode}90`;
  const effectXyzCode = `${testCase.materialCode}91`;
  const otherMaterialCode = `${testCase.materialCode}92`;
  const baseAttack = 2100;
  const cards: DuelCardData[] = [
    { code: testCase.materialCode, name: testCase.materialName, kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: otherMaterialCode, name: `${testCase.materialName} Partner`, kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200 },
    { code: normalXyzCode, name: `${testCase.materialName} Normal Xyz`, kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: baseAttack, defense: 1800, xyzMaterialCount: 2 },
    { code: effectXyzCode, name: `${testCase.materialName} Effect Xyz`, kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: baseAttack, defense: 1800, xyzMaterialCount: 2 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: Number(testCase.materialCode), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [testCase.materialCode, otherMaterialCode], extra: [normalXyzCode, effectXyzCode] }, 1: { main: [] } });
  startDuel(session);

  const material = requireCard(session, testCase.materialCode);
  const otherMaterial = requireCard(session, otherMaterialCode);
  const normalXyz = requireCard(session, normalXyzCode);
  const effectXyz = requireCard(session, effectXyzCode);
  moveDuelCard(session.state, material.uid, "monsterZone", 0).position = "faceUpAttack";
  material.faceUp = true;
  moveDuelCard(session.state, otherMaterial.uid, "monsterZone", 0).position = "faceUpAttack";
  otherMaterial.faceUp = true;
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(testCase.materialCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(session.state.effects.find((effect) => effect.sourceUid === material.uid && effect.event === "continuous" && effect.code === eventBeMaterial)).toMatchObject({
    code: eventBeMaterial,
    event: "continuous",
    sourceUid: material.uid,
  });
  expect((session.state.effects.find((effect) => effect.sourceUid === material.uid && effect.event === "continuous" && effect.code === eventBeMaterial)?.luaTypeFlags ?? 0) & 1).toBe(1);
  expect(getDuelLegalActions(session, 0).some((action) => action.type === "xyzSummon" && action.uid === normalXyz.uid)).toBe(true);
  expect(getDuelLegalActions(session, 0).some((action) => action.type === "xyzSummon" && action.uid === effectXyz.uid)).toBe(true);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);

  const summoned = xyzSummonDuelCard(restoredOpen.session.state, 0, normalXyz.uid, [material.uid, otherMaterial.uid]);
  expect(summoned.uid).toBe(normalXyz.uid);
  expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
    location: "overlay",
    reason: duelReason.material | duelReason.xyz,
    reasonCardUid: normalXyz.uid,
  });
  expect(restoredOpen.session.state.cards.find((card) => card.uid === otherMaterial.uid)).toMatchObject({
    location: "overlay",
    reason: duelReason.material | duelReason.xyz,
    reasonCardUid: normalXyz.uid,
  });
  expect(restoredOpen.session.state.cards.find((card) => card.uid === normalXyz.uid)).toMatchObject({
    location: "monsterZone",
    summonType: "xyz",
    summonMaterialUids: [material.uid, otherMaterial.uid],
  });
  expect(
    restoredOpen.session.state.eventHistory.filter(
      (event) => (event.eventName === "usedAsMaterial" && event.eventCardUid === material.uid) || (event.eventName === "specialSummoned" && event.eventCardUid === normalXyz.uid),
    ),
  ).toEqual([
    {
      eventName: "usedAsMaterial",
      eventCode: eventBeMaterial,
      eventReason: duelReason.xyz,
      eventReasonPlayer: 0,
      eventReasonCardUid: normalXyz.uid,
      eventPreviousState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      eventCurrentState: { controller: 0, location: "overlay", sequence: 0, position: "faceUpAttack", faceUp: false },
      eventCardUid: material.uid,
    },
    {
      eventName: "specialSummoned",
      eventCode: eventSpecialSummonSuccess,
      eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz,
      eventReasonPlayer: 0,
      eventPreviousState: { controller: 0, location: "extraDeck", sequence: 0, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      eventCardUid: normalXyz.uid,
    },
  ]);
  expect(restoredOpen.session.state.pendingTriggers).toEqual([
    {
      id: "trigger-6-1",
      player: 0,
      sourceUid: normalXyz.uid,
      effectId: "lua-2-1102",
      eventName: "specialSummoned",
      eventPlayer: 0,
      triggerBucket: "turnMandatory",
      eventCode: eventSpecialSummonSuccess,
      eventTriggerTiming: "when",
      eventCardUid: normalXyz.uid,
      eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz,
      eventReasonPlayer: 0,
      eventPreviousState: { controller: 0, location: "extraDeck", sequence: 0, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
    },
  ]);
  expect(cardTypeFlags(normalXyz, restoredOpen.session.state) & typeEffect).toBe(typeEffect);
  expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === normalXyz.uid && effect.code === effectAddType)).toMatchObject({
    code: effectAddType,
    value: typeEffect,
  });
  expect(currentAttack(normalXyz, restoredOpen.session.state)).toBe(baseAttack);

  const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredTriggerWindow);
  expectRestoredLegalActions(restoredTriggerWindow, 0);
  expect(restoredTriggerWindow.session.state.effects.find((effect) => effect.sourceUid === normalXyz.uid && effect.code === eventSpecialSummonSuccess)).toMatchObject({
    description: testCase.stringId,
  });
  const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === normalXyz.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
  expect(restoredTriggerWindow.session.state.chain.map((link) => link.operationInfos ?? [])).toEqual([]);
  resolveRestoredChain(restoredTriggerWindow);
  expect(currentAttack(requireCard(restoredTriggerWindow.session, normalXyzCode), restoredTriggerWindow.session.state)).toBe(baseAttack + testCase.boost);
  expect(restoredTriggerWindow.session.state.effects.find((effect) => effect.sourceUid === normalXyz.uid && effect.code === effectUpdateAttack)).toMatchObject({
    code: effectUpdateAttack,
    value: testCase.boost,
  });

  const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), workspace, reader);
  expectCleanRestore(restoredResolved);
  expectRestoredLegalActions(restoredResolved, 0);
  const restoredNormalXyz = requireCard(restoredResolved.session, normalXyzCode);
  expect(cardTypeFlags(restoredNormalXyz, restoredResolved.session.state) & typeEffect).toBe(typeEffect);
  expect(currentAttack(restoredNormalXyz, restoredResolved.session.state)).toBe(baseAttack + testCase.boost);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
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
