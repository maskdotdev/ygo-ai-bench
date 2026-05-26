import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const kochoboCode = "55359571";
const machineTargetCode = "553595710";
const xyzCode = "553595711";
const fusionCode = "553595712";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKochoboScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kochoboCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectCannotSpecialSummon = 22;
const effectLeaveFieldRedirect = 60;
const effectSetAttackFinal = 102;
const effectChangeLevel = 131;
const clockLizardCode = 51476410;

describe.skipIf(!hasUpstreamScripts || !hasKochoboScript)("Lua real script Kochobo Hinamatsuri revive lock stat", () => {
  it("restores targeted Graveyard SpecialSummonStep into Xyz-only lock, redirect, final ATK, and Level copy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${kochoboCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 55359571, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kochoboCode, machineTargetCode], extra: [xyzCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const kochobo = requireCard(session, kochoboCode);
    const machineTarget = requireCard(session, machineTargetCode);
    const xyz = requireCard(session, xyzCode);
    const fusion = requireCard(session, fusionCode);
    moveDuelCard(session.state, kochobo.uid, "graveyard", 0);
    moveFaceUpAttack(session, machineTarget, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kochoboCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const revive = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === kochobo.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, revive!);

    const restoredKochobo = restoredOpen.session.state.cards.find((card) => card.uid === kochobo.uid);
    const restoredMachine = restoredOpen.session.state.cards.find((card) => card.uid === machineTarget.uid);
    expect(restoredKochobo).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: kochobo.uid,
      reasonEffectId: 1,
    });
    expect(currentLevel(restoredKochobo, restoredOpen.session.state)).toBe(4);
    expect(currentAttack(restoredMachine, restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === kochobo.uid && [effectCannotSpecialSummon, effectLeaveFieldRedirect, effectChangeLevel, clockLizardCode].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotSpecialSummon, description: 885753137, luaTargetDescriptor: "special-summon-limit:not-type-extra:8388608", property: 0x4000800, reset: { flags: 0x40000200 }, targetRange: [1, 0], value: undefined },
      { code: clockLizardCode, description: undefined, luaTargetDescriptor: "target:not-original-type:8388608", property: undefined, reset: { flags: 0x40000200 }, targetRange: [0xff, 0], value: 1 },
      { code: effectLeaveFieldRedirect, description: 3300, luaTargetDescriptor: undefined, property: 0x4000400, reset: { flags: 209326080 }, targetRange: undefined, value: 0x20 },
      { code: effectChangeLevel, description: undefined, luaTargetDescriptor: undefined, property: undefined, reset: { flags: 33492992 }, targetRange: undefined, value: 4 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === machineTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: machineTarget.uid, value: 1000 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: machineTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: kochobo.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: kochobo.uid,
        eventReasonEffectId: 1,
        eventUids: [kochobo.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === machineTarget.uid), restoredAfter.session.state)).toBe(1000);
    expect(currentLevel(restoredAfter.session.state.cards.find((card) => card.uid === kochobo.uid), restoredAfter.session.state)).toBe(4);
    const lizard = restoredAfter.session.state.effects.find((effect) => effect.code === clockLizardCode);
    const source = restoredAfter.session.state.cards.find((card) => card.uid === kochobo.uid);
    const restoredXyz = restoredAfter.session.state.cards.find((card) => card.uid === xyz.uid);
    const restoredFusion = restoredAfter.session.state.cards.find((card) => card.uid === fusion.uid);
    expect(lizard?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(restoredXyz).toBeDefined();
    expect(restoredFusion).toBeDefined();
    const ctx = targetContext(restoredAfter.session.state, source!);
    expect(lizard!.targetCardPredicate!(ctx, restoredXyz!)).toBe(false);
    expect(lizard!.targetCardPredicate!(ctx, restoredFusion!)).toBe(true);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE+CATEGORY_LVCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,tc:GetFirst():GetAttack()//2)");
  expect(script).toContain("e0:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("aux.addTempLizardCheck(c,tp,function(e,c) return not c:IsOriginalType(TYPE_XYZ) end)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e3:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: kochoboCode, name: "Kochobo's Hinamatsuri", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 7, attack: 2200, defense: 2200 },
    { code: machineTargetCode, name: "Kochobo Machine Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
    { code: xyzCode, name: "Kochobo Xyz Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: fusionCode, name: "Kochobo Fusion Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceMachine, attribute: attributeLight, level: 6, attack: 1000, defense: 1000 },
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

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
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
