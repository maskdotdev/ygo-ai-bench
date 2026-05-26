import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { canNegateDuelChainLinkObject, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { ChainLink, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sagaCode = "66156348";
const targetDragonCode = "661563480";
const opponentDragonCode = "661563481";
const graveXyzDragonCode = "661563482";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSagaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sagaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;
const effectCannotInactivate = 12;
const effectFlagClientHint = 0x4000000;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasSagaScript)("Lua real script Saga of the Dragon Emperor double attack summon", () => {
  it("restores damage-step Dragon ATK doubling, no-inactivate grant, and grave self-banish Xyz summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectSagaScriptShape(workspace.readScript(`official/c${sagaCode}.lua`));
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredActivationField({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const saga = requireCard(restoredActivation.session, sagaCode);
    const targetDragon = requireCard(restoredActivation.session, targetDragonCode);
    const opponentDragon = requireCard(restoredActivation.session, opponentDragonCode, 1);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === saga.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === saga.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === targetDragon.uid), restoredActivation.session.state)).toBe(3000);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === targetDragon.uid && [effectSetAttackFinal, effectCannotInactivate].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, description: undefined, property: undefined, registryKey: `lua:${sagaCode}:lua-3-102`, reset: { flags: resetStandardPhaseEnd }, sourceUid: targetDragon.uid, value: 3000 },
      { code: effectCannotInactivate, description: 1058501570, property: effectFlagClientHint, registryKey: `lua:${sagaCode}:lua-4-12`, reset: { flags: resetStandardPhaseEnd }, sourceUid: targetDragon.uid, value: undefined },
    ]);
    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === targetDragon.uid), restoredPersistent.session.state)).toBe(3000);
    const protectedChain: ChainLink = { id: "chain-protected-dragon", chainIndex: 1, player: 0, sourceUid: targetDragon.uid, effectId: "probe-protected" };
    const unrelatedChain: ChainLink = { id: "chain-opponent-dragon", chainIndex: 1, player: 1, sourceUid: opponentDragon.uid, effectId: "probe-unrelated" };
    expect(canNegateDuelChainLinkObject(restoredPersistent.session.state, protectedChain)).toBe(false);
    expect(canNegateDuelChainLinkObject(restoredPersistent.session.state, unrelatedChain)).toBe(true);

    const restoredSummon = createRestoredGraveSummonField({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const graveSaga = requireCard(restoredSummon.session, sagaCode);
    const graveXyz = requireCard(restoredSummon.session, graveXyzDragonCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveSaga.uid && action.effectId === "lua-2-1002",
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === graveSaga.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveSaga.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === graveXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveSaga.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveSaga.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveSaga.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: graveXyz.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: graveSaga.uid, eventReasonEffectId: 2, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredActivationField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66156348, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [sagaCode, targetDragonCode] }, 1: { main: [opponentDragonCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, sagaCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, targetDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentDragonCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sagaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66156349, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [sagaCode], extra: [graveXyzDragonCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, sagaCode).uid, "graveyard", 0);
  const xyz = moveDuelCard(session.state, requireCard(session, graveXyzDragonCode).uid, "graveyard", 0);
  xyz.faceUp = true;
  xyz.position = "faceUpAttack";
  xyz.customStatusMask = statusProcComplete;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sagaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectSagaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Saga of the Dragon Emperor");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_DRAGON),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_INACTIVATE)");
  expect(script).toContain("Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT):GetHandler()");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_DRAGON) and c:IsType(TYPE_XYZ) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE|LOCATION_REMOVED)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: sagaCode, name: "Saga of the Dragon Emperor", kind: "spell", typeFlags: typeSpell },
    { code: targetDragonCode, name: "Saga Target Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1500, defense: 1200 },
    { code: opponentDragonCode, name: "Saga Opponent Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: graveXyzDragonCode, name: "Saga Grave Xyz Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, level: 4, attack: 2400, defense: 2000 },
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
    expect(++guard).toBeLessThan(10);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
